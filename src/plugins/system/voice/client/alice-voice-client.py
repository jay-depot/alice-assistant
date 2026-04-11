#!/usr/bin/env python3

import json
import importlib
import inspect
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def find_first_available_command(commands: list[str]) -> str | None:
    for command in commands:
        if shutil.which(command):
            return command
    return None


def run_command(command: list[str]) -> None:
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def load_system_config() -> dict:
    config_path = Path.home() / '.alice-assistant' / 'alice.json'
    if not config_path.exists():
        raise RuntimeError(f'ALICE config file not found at {config_path}')

    return json.loads(config_path.read_text(encoding='utf-8'))


def get_record_seconds() -> int:
    try:
        return max(1, int(os.environ.get('ALICE_VOICE_RECORD_SECONDS', '7')))
    except ValueError:
        return 7


def get_wake_threshold() -> float:
    try:
        return float(os.environ.get('ALICE_VOICE_WAKE_THRESHOLD', '0.5'))
    except ValueError:
        return 0.5


def get_post_reply_cooldown_seconds() -> float:
    try:
        return max(0.0, float(os.environ.get('ALICE_VOICE_POST_REPLY_COOLDOWN_SECONDS', '1.5')))
    except ValueError:
        return 1.5


def record_audio_clip(seconds: int = 7) -> str:
    output_path = Path(tempfile.gettempdir()) / f'alice-voice-client-{os.getpid()}-{seconds}.wav'
    recorder = find_first_available_command(['arecord', 'ffmpeg'])
    if recorder is None:
        raise RuntimeError('No recorder found. Install arecord (alsa-utils) or ffmpeg.')

    if recorder == 'arecord':
        run_command([
            'arecord',
            '-q',
            '-f', 'S16_LE',
            '-r', '16000',
            '-c', '1',
            '-d', str(seconds),
            str(output_path),
        ])
    else:
        run_command([
            'ffmpeg',
            '-y',
            '-f', 'alsa',
            '-i', 'default',
            '-ac', '1',
            '-ar', '16000',
            '-t', str(seconds),
            str(output_path),
        ])

    return str(output_path)


def transcribe_audio_file(audio_path: str) -> str:
    output_dir = tempfile.mkdtemp(prefix='alice-voice-whisper-')
    preferred_command = os.environ.get('ALICE_WHISPER_CMD', '').strip()
    whisper_command = preferred_command or find_first_available_command(['whisper', 'whisper-cli'])

    if whisper_command is None:
        raise RuntimeError('No Whisper command found. Install python whisper or whisper-cli.')

    audio_name = Path(audio_path).stem
    try:
        if whisper_command == 'whisper':
            run_command([
                'whisper',
                audio_path,
                '--model', os.environ.get('ALICE_WHISPER_MODEL', 'base'),
                '--task', 'transcribe',
                '--output_format', 'txt',
                '--output_dir', output_dir,
            ])
            transcript_path = Path(output_dir) / f'{audio_name}.txt'
        else:
            output_prefix = str(Path(output_dir) / audio_name)
            run_command([
                'whisper-cli',
                '-f', audio_path,
                '-otxt',
                '-of', output_prefix,
            ])
            transcript_path = Path(f'{output_prefix}.txt')

        if not transcript_path.exists():
            raise RuntimeError(f'Expected transcript file not found at {transcript_path}')

        return transcript_path.read_text(encoding='utf-8').strip()
    finally:
        shutil.rmtree(output_dir, ignore_errors=True)


def synthesize_speech_to_temp_file(text: str, system_config: dict) -> str:
    piper_config = system_config.get('piperTts', {})
    base_url = str(piper_config.get('host', '')).rstrip('/')
    payload = json.dumps({
        'text': text,
        'model': piper_config.get('model'),
        'speaker': piper_config.get('speaker'),
    }).encode('utf-8')

    destination_path = Path(tempfile.gettempdir()) / f'alice-voice-tts-{os.getpid()}.wav'
    last_error: Exception | None = None

    for endpoint in ['/api/tts', '/tts']:
        try:
            request = urllib.request.Request(
                f'{base_url}{endpoint}',
                data=payload,
                headers={'content-type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(request) as response:
                content_type = response.headers.get('content-type', '')
                response_body = response.read()

            if 'application/json' in content_type:
                decoded = json.loads(response_body.decode('utf-8'))
                audio_base64 = decoded.get('audioBase64') or decoded.get('audio') or decoded.get('wavBase64')
                if not isinstance(audio_base64, str):
                    raise RuntimeError('Piper JSON response did not include an audio payload.')

                import base64

                destination_path.write_bytes(base64.b64decode(audio_base64))
            else:
                destination_path.write_bytes(response_body)

            return str(destination_path)
        except Exception as error:
            last_error = error

    raise RuntimeError(f'Unable to synthesize speech with piper server at {base_url}: {last_error}')


def play_audio_file(audio_path: str) -> None:
    player = find_first_available_command(['paplay', 'aplay', 'ffplay'])
    if player is None:
        raise RuntimeError('No audio playback command found. Install paplay, aplay, or ffplay.')

    if player == 'paplay':
        run_command(['paplay', audio_path])
    elif player == 'aplay':
        run_command(['aplay', audio_path])
    else:
        run_command(['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', audio_path])


def send_voice_turn(message: str) -> str:
    base_url = os.environ.get('ALICE_VOICE_BASE_URL', '').rstrip('/')
    token = os.environ.get('ALICE_VOICE_TOKEN', '')
    request = urllib.request.Request(
        f'{base_url}/api/voice/turn',
        data=json.dumps({'message': message}).encode('utf-8'),
        headers={
            'content-type': 'application/json',
            'authorization': f'Bearer {token}',
        },
        method='POST',
    )

    with urllib.request.urlopen(request) as response:
        response_json = json.loads(response.read().decode('utf-8'))

    reply = response_json.get('reply')
    if not isinstance(reply, str) or not reply.strip():
        raise RuntimeError('Voice API did not return a reply.')

    return reply


def check_health() -> None:
    base_url = os.environ.get('ALICE_VOICE_BASE_URL', '').rstrip('/')
    token = os.environ.get('ALICE_VOICE_TOKEN', '')
    request = urllib.request.Request(
        f'{base_url}/api/voice/health',
        headers={
            'authorization': f'Bearer {token}',
        },
        method='GET',
    )

    with urllib.request.urlopen(request) as response:
        response_json = json.loads(response.read().decode('utf-8'))

    if not response_json.get('ok'):
        raise RuntimeError('Voice API health check did not return ok=true.')


def import_wake_word_runtime():
    try:
        np = importlib.import_module('numpy')
        sd = importlib.import_module('sounddevice')
        model_module = importlib.import_module('openwakeword.model')
        Model = getattr(model_module, 'Model')
    except ImportError as error:
        raise RuntimeError(
            'Wake-word voice mode requires Python packages openwakeword, numpy, and sounddevice. '
            'Set ALICE_VOICE_MANUAL=1 to use manual dev mode instead.'
        ) from error

    return np, sd, Model


def get_open_wake_word_model_path(system_config: dict) -> str:
    configured_model = str(system_config.get('openWakeWord', {}).get('model', '')).strip()
    if not configured_model:
        raise RuntimeError(
            'Wake-word voice mode requires alice.json openWakeWord.model to point to a trained OpenWakeWord model file. '
            'Set ALICE_VOICE_MANUAL=1 to use manual dev mode instead.'
        )

    return configured_model


def create_wake_word_model(Model, model_path: str):
    parameter_names = set(inspect.signature(Model.__init__).parameters.keys())

    if 'wakeword_models' in parameter_names:
        if model_path.endswith('.onnx'):
            return Model(wakeword_models=[model_path], inference_framework='onnx')

        return Model(wakeword_models=[model_path])

    if 'wakeword_model_paths' in parameter_names:
        if model_path.endswith('.tflite'):
            raise RuntimeError(
                'The installed openwakeword package only supports the older ONNX-based API, but the configured wake-word model is a .tflite file. '
                'Use the .onnx model instead, or install a newer openwakeword build that supports tflite wakeword_models.'
            )

        return Model(wakeword_model_paths=[model_path])

    raise RuntimeError('Unsupported openwakeword Model constructor shape. Unable to initialize wake-word model safely.')


def wait_for_wake_word(system_config: dict) -> None:
    np, sd, Model = import_wake_word_runtime()
    model_path = get_open_wake_word_model_path(system_config)
    threshold = get_wake_threshold()
    chunk_size = 1280

    print(f'voice client: listening for wake word using model {model_path}')

    wake_model = create_wake_word_model(Model, model_path)

    with sd.RawInputStream(samplerate=16000, channels=1, dtype='int16', blocksize=chunk_size) as stream:
        while True:
            audio_chunk, overflowed = stream.read(chunk_size)
            if overflowed:
                continue

            prediction_input = np.frombuffer(audio_chunk, dtype=np.int16)
            prediction = wake_model.predict(prediction_input)
            score = max((float(value) for value in prediction.values()), default=0.0)

            if score >= threshold:
                print(f'voice client: wake word detected with score {score:.3f}')
                return


def run_manual_loop(system_config: dict) -> None:
    wake_word = os.environ.get('ALICE_VOICE_WAKE_WORD', system_config.get('wakeWord', 'Hey ALICE'))
    print(f'ALICE voice client ready. Wake word configured as: {wake_word}')
    print('Manual dev mode: press Enter to record one turn, type text to send it directly, or type q to quit.')

    while True:
        try:
            user_input = input('voice> ').strip()
        except EOFError:
            print('voice client: stdin closed, exiting.')
            return

        if user_input.lower() in {'q', 'quit', 'exit'}:
            print('voice client: exit requested.')
            return

        if user_input:
            transcript = user_input
        else:
            audio_path = record_audio_clip(get_record_seconds())
            try:
                transcript = transcribe_audio_file(audio_path)
            finally:
                Path(audio_path).unlink(missing_ok=True)

        if not transcript:
            print('voice client: no transcript detected.')
            continue

        print(f'user: {transcript}')
        reply = send_voice_turn(transcript)
        print(f'ALICE: {reply}')

        audio_path = synthesize_speech_to_temp_file(reply, system_config)
        try:
            play_audio_file(audio_path)
        finally:
            Path(audio_path).unlink(missing_ok=True)


def run_wake_word_loop(system_config: dict) -> None:
    wake_word = os.environ.get('ALICE_VOICE_WAKE_WORD', system_config.get('wakeWord', 'Hey ALICE'))
    print(f'ALICE voice client ready. Waiting for wake word: {wake_word}')

    while True:
        wait_for_wake_word(system_config)

        audio_path = record_audio_clip(get_record_seconds())
        try:
            transcript = transcribe_audio_file(audio_path)
        finally:
            Path(audio_path).unlink(missing_ok=True)

        if not transcript:
            print('voice client: no transcript detected after wake word.')
            continue

        print(f'user: {transcript}')
        reply = send_voice_turn(transcript)
        print(f'ALICE: {reply}')

        audio_path = synthesize_speech_to_temp_file(reply, system_config)
        try:
            play_audio_file(audio_path)
        finally:
            Path(audio_path).unlink(missing_ok=True)

        cooldown = get_post_reply_cooldown_seconds()
        if cooldown > 0:
            time.sleep(cooldown)


def main() -> int:
    try:
        system_config = load_system_config()
        check_health()
        if os.environ.get('ALICE_VOICE_MANUAL', '').strip() == '1':
            run_manual_loop(system_config)
        else:
            run_wake_word_loop(system_config)
        return 0
    except urllib.error.HTTPError as error:
        sys.stderr.write(f'voice client HTTP error: {error.code} {error.reason}\n')
        return 1
    except Exception as error:
        sys.stderr.write(f'voice client failed: {error}\n')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())