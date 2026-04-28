#!/usr/bin/env python3

import json
import importlib
import inspect
import os
import signal
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import warnings
import wave
from math import ceil
from pathlib import Path


shutdown_requested = False


def handle_shutdown_signal(signum, _frame) -> None:
    global shutdown_requested
    if shutdown_requested:
        # Second signal: force-exit immediately so nothing can swallow it.
        signal_name = signal.Signals(signum).name if signum in signal.Signals._value2member_map_ else str(signum)
        print(f'voice client: received second {signal_name}, forcing exit.')
        os._exit(0)

    shutdown_requested = True
    signal_name = signal.Signals(signum).name if signum in signal.Signals._value2member_map_ else str(signum)
    print(f'voice client: received {signal_name}, exiting.')
    raise KeyboardInterrupt()


signal.signal(signal.SIGINT, handle_shutdown_signal)
signal.signal(signal.SIGTERM, handle_shutdown_signal)


def find_first_available_command(commands: list[str]) -> str | None:
    for command in commands:
        if shutil.which(command):
            return command
    return None


def build_audio_playback_command(audio_path: str) -> list[str]:
    player = find_first_available_command(['paplay', 'aplay', 'ffplay'])
    if player is None:
        raise RuntimeError('No audio playback command found. Install paplay, aplay, or ffplay.')

    if player == 'paplay':
        return ['paplay', audio_path]
    if player == 'aplay':
        return ['aplay', audio_path]

    return ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', audio_path]


def run_command(command: list[str]) -> None:
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def load_system_config() -> dict:
    config_path = Path.home() / '.alice-assistant' / 'alice.json'
    if not config_path.exists():
        raise RuntimeError(f'ALICE config file not found at {config_path}')

    return json.loads(config_path.read_text(encoding='utf-8'))


def load_voice_plugin_config() -> dict:
    config_path = Path.home() / '.alice-assistant' / 'plugin-settings' / 'voice' / 'voice.json'
    if not config_path.exists():
        return {}

    try:
        return json.loads(config_path.read_text(encoding='utf-8'))
    except Exception:
        return {}


def configure_runtime_warnings() -> None:
    warnings.filterwarnings(
        'ignore',
        message=r"Specified provider 'CUDAExecutionProvider' is not in available provider names.*",
        category=UserWarning,
    )


def get_config_number(
    voice_plugin_config: dict,
    config_key: str,
    env_keys: list[str],
    default_value: float,
    minimum: float,
) -> float:
    for env_key in env_keys:
        raw_value = os.environ.get(env_key, '').strip()
        if not raw_value:
            continue

        try:
            return max(minimum, float(raw_value))
        except ValueError:
            continue

    configured_value = voice_plugin_config.get(config_key)
    if isinstance(configured_value, (int, float)):
        return max(minimum, float(configured_value))

    return max(minimum, default_value)


def get_config_string(
    voice_plugin_config: dict,
    config_key: str,
    env_keys: list[str],
    default_value: str,
) -> str:
    for env_key in env_keys:
        raw_value = os.environ.get(env_key, '').strip()
        if raw_value:
            return raw_value

    configured_value = voice_plugin_config.get(config_key)
    if isinstance(configured_value, str) and configured_value.strip():
        return configured_value.strip()

    return default_value


def get_min_capture_seconds(voice_plugin_config: dict) -> float:
    return get_config_number(voice_plugin_config, 'minCaptureSeconds', ['ALICE_VOICE_MIN_CAPTURE_SECONDS'], 1.25, 0.1)


def get_max_capture_seconds(voice_plugin_config: dict) -> float:
    return get_config_number(
        voice_plugin_config,
        'maxCaptureSeconds',
        ['ALICE_VOICE_MAX_CAPTURE_SECONDS', 'ALICE_VOICE_RECORD_SECONDS'],
        7.0,
        0.5,
    )


def get_trailing_silence_ms(voice_plugin_config: dict) -> float:
    return get_config_number(voice_plugin_config, 'trailingSilenceMs', ['ALICE_VOICE_TRAILING_SILENCE_MS'], 900.0, 100.0)


def get_speech_threshold(voice_plugin_config: dict) -> float:
    return get_config_number(voice_plugin_config, 'speechThreshold', ['ALICE_VOICE_SPEECH_THRESHOLD'], 0.015, 0.0001)


def get_preroll_ms(voice_plugin_config: dict) -> float:
    return get_config_number(voice_plugin_config, 'prerollMs', ['ALICE_VOICE_PREROLL_MS'], 250.0, 0.0)


def get_background_noise_sample_seconds(voice_plugin_config: dict) -> float:
    return get_config_number(
        voice_plugin_config,
        'backgroundNoiseSampleSeconds',
        ['ALICE_VOICE_BACKGROUND_NOISE_SAMPLE_SECONDS'],
        0.75,
        0.1,
    )


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


def get_continuation_capture_settle_seconds(voice_plugin_config: dict) -> float:
    return get_config_number(
        voice_plugin_config,
        'continuationCaptureSettleSeconds',
        ['ALICE_VOICE_CONTINUATION_CAPTURE_SETTLE_SECONDS'],
        0.35,
        0.0,
    )


def get_continuation_noise_floor_multiplier(voice_plugin_config: dict) -> float:
    return get_config_number(
        voice_plugin_config,
        'continuationNoiseFloorMultiplier',
        ['ALICE_VOICE_CONTINUATION_NOISE_MULTIPLIER'],
        1.5,
        0.0,
    )


def get_continuation_threshold_cap_multiplier(voice_plugin_config: dict) -> float:
    return get_config_number(
        voice_plugin_config,
        'continuationThresholdCapMultiplier',
        ['ALICE_VOICE_CONTINUATION_THRESHOLD_CAP_MULTIPLIER'],
        2.0,
        1.0,
    )


def get_continuation_silence_prompt(voice_plugin_config: dict) -> str:
    return get_config_string(
        voice_plugin_config,
        'continuationSilencePrompt',
        ['ALICE_VOICE_CONTINUATION_SILENCE_PROMPT'],
        'All right, I will close that conversation now.',
    )


def get_archiving_started_prompt(voice_plugin_config: dict) -> str:
    return get_config_string(
        voice_plugin_config,
        'archivingStartedPrompt',
        ['ALICE_VOICE_ARCHIVING_STARTED_PROMPT'],
        'Archiving that now, one moment.',
    )


def get_archiving_completed_prompt(voice_plugin_config: dict) -> str:
    return get_config_string(
        voice_plugin_config,
        'archivingCompletedPrompt',
        ['ALICE_VOICE_ARCHIVING_COMPLETED_PROMPT'],
        'Finished archiving, ready for another request.',
    )


def get_optional_sound_path(voice_plugin_config: dict, key: str) -> Path | None:
    configured_path = str(voice_plugin_config.get(key, '')).strip()
    if not configured_path:
        return None

    sound_path = Path(configured_path).expanduser()
    if not sound_path.exists():
        print(f'voice client: configured sound file does not exist for {key}: {sound_path}')
        return None

    return sound_path


def import_audio_capture_runtime():
    try:
        np = importlib.import_module('numpy')
        sd = importlib.import_module('sounddevice')
    except ImportError as error:
        raise RuntimeError(
            'Voice capture requires Python packages numpy and sounddevice. '
            'Install the bundled voice client requirements to continue.'
        ) from error

    return np, sd


def compute_normalized_rms(np, audio_chunk: bytes) -> float:
    samples = np.frombuffer(audio_chunk, dtype=np.int16)
    if samples.size == 0:
        return 0.0

    float_samples = samples.astype(np.float32)
    rms = float(np.sqrt(np.mean(np.square(float_samples))))
    return rms / 32768.0


def write_wav_file(output_path: Path, audio_chunks: list[bytes], sample_rate: int) -> None:
    with wave.open(str(output_path), 'wb') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for audio_chunk in audio_chunks:
            wav_file.writeframes(audio_chunk)


def build_capture_debug_payload(
    source: str,
    stop_reason: str,
    speech_detected: bool,
    min_capture_seconds: float,
    max_capture_seconds: float,
    trailing_silence_ms: float,
    speech_threshold: float,
    effective_speech_threshold: float,
    noise_floor_rms: float,
    preroll_ms: float,
    captured_seconds: float | None,
) -> dict:
    return {
        'source': source,
        'stopReason': stop_reason,
        'capturedSeconds': captured_seconds,
        'speechDetected': speech_detected,
        'minCaptureSeconds': min_capture_seconds,
        'maxCaptureSeconds': max_capture_seconds,
        'trailingSilenceMs': trailing_silence_ms,
        'speechThreshold': speech_threshold,
        'effectiveSpeechThreshold': effective_speech_threshold,
        'noiseFloorRms': noise_floor_rms,
        'prerollMs': preroll_ms,
        'clientRecordedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
    }


def sample_background_noise(voice_plugin_config: dict) -> float:
    np, sd = import_audio_capture_runtime()
    sample_rate = 16000
    chunk_size = 1600
    sample_seconds = get_background_noise_sample_seconds(voice_plugin_config)
    sample_chunks = max(1, ceil(sample_seconds / (chunk_size / sample_rate)))
    sampled_rms_values: list[float] = []

    print(f'voice client: sampling background noise for {sample_seconds:.2f}s before capture.')

    with sd.RawInputStream(samplerate=sample_rate, channels=1, dtype='int16', blocksize=chunk_size) as stream:
        for _ in range(sample_chunks):
            audio_chunk, overflowed = stream.read(chunk_size)
            if overflowed:
                continue

            sampled_rms_values.append(compute_normalized_rms(np, bytes(audio_chunk)))

    if not sampled_rms_values:
        print('voice client: background noise sampling overflowed completely; falling back to configured threshold only.')
        return 0.0

    noise_floor_rms = sum(sampled_rms_values) / len(sampled_rms_values)
    print(f'voice client: sampled background noise floor rms={noise_floor_rms:.4f}.')
    return noise_floor_rms


def record_audio_clip(
    voice_plugin_config: dict,
    initial_noise_floor_rms: float,
    listening_sound_path: Path | None = None,
    noise_floor_multiplier: float = 3.0,
    max_effective_threshold: float | None = None,
) -> dict:
    np, sd = import_audio_capture_runtime()
    sample_rate = 16000
    chunk_size = 1600
    chunk_duration_seconds = chunk_size / sample_rate
    min_capture_seconds = get_min_capture_seconds(voice_plugin_config)
    max_capture_seconds = max(get_max_capture_seconds(voice_plugin_config), min_capture_seconds)
    trailing_silence_ms = get_trailing_silence_ms(voice_plugin_config)
    speech_threshold = get_speech_threshold(voice_plugin_config)
    preroll_ms = get_preroll_ms(voice_plugin_config)

    max_chunks = max(1, ceil(max_capture_seconds / chunk_duration_seconds))
    min_chunks = max(1, ceil(min_capture_seconds / chunk_duration_seconds))
    trailing_silence_chunks = max(1, ceil((trailing_silence_ms / 1000.0) / chunk_duration_seconds))

    captured_chunks: list[bytes] = []
    speech_detected = False
    consecutive_silent_chunks = 0
    stop_reason = 'max-duration'
    noise_floor_rms = initial_noise_floor_rms
    effective_speech_threshold = max(speech_threshold, noise_floor_rms * noise_floor_multiplier)
    if isinstance(max_effective_threshold, (int, float)):
        effective_speech_threshold = min(effective_speech_threshold, float(max_effective_threshold))
    speech_start_chunk_index: int | None = None

    print(
        'voice client: starting capture '
        f'(min={min_capture_seconds:.2f}s, max={max_capture_seconds:.2f}s, trailing_silence_ms={int(trailing_silence_ms)}, '
        f'configured_threshold={speech_threshold:.4f}, effective_threshold={effective_speech_threshold:.4f}, preroll_ms={int(preroll_ms)}).'
    )

    with sd.RawInputStream(samplerate=sample_rate, channels=1, dtype='int16', blocksize=chunk_size) as stream:
        listening_sound_process = None

        if listening_sound_path is not None:
            try:
                listening_sound_process = subprocess.Popen(
                    build_audio_playback_command(str(listening_sound_path)),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                print('voice client: playing listening cue while priming capture stream.')
            except Exception as error:
                print(f'voice client: failed to play listening cue {listening_sound_path}: {error}')
                listening_sound_process = None

        overlap_chunks_count = max(1, ceil((preroll_ms / 1000.0) / chunk_duration_seconds))
        drain_overlap: list[bytes] = []

        while listening_sound_process is not None and listening_sound_process.poll() is None and not shutdown_requested:
            audio_chunk, overflowed = stream.read(chunk_size)
            if not overflowed:
                drain_overlap.append(bytes(audio_chunk))
                if len(drain_overlap) > overlap_chunks_count:
                    drain_overlap.pop(0)

        if listening_sound_process is not None:
            listening_sound_process.wait()
            print('voice client: listening cue finished, retaining audio for transcription.')

        # Prepend the tail of the drain phase so first-syllable audio is never discarded.
        captured_chunks.extend(drain_overlap)

        for _ in range(max_chunks):
            if shutdown_requested:
                stop_reason = 'shutdown'
                break

            audio_chunk, overflowed = stream.read(chunk_size)
            # Keep overflowed chunks — losing them causes transcription gaps.
            audio_bytes = bytes(audio_chunk)
            chunk_rms = compute_normalized_rms(np, audio_bytes)
            captured_chunks.append(audio_bytes)

            if not speech_detected:
                chunk_has_speech = chunk_rms >= effective_speech_threshold
            else:
                chunk_has_speech = chunk_rms >= effective_speech_threshold

            if not speech_detected:
                if not chunk_has_speech:
                    continue

                speech_detected = True
                speech_start_chunk_index = len(captured_chunks) - 1
                print(
                    'voice client: speech detected '
                    f'(chunk_rms={chunk_rms:.4f}, noise_floor_rms={noise_floor_rms:.4f}, effective_threshold={effective_speech_threshold:.4f}).'
                )
                consecutive_silent_chunks = 0
                continue

            if chunk_has_speech:
                consecutive_silent_chunks = 0
                continue

            consecutive_silent_chunks += 1
            speech_chunk_count = len(captured_chunks) - (speech_start_chunk_index or 0)
            if speech_chunk_count >= min_chunks and consecutive_silent_chunks >= trailing_silence_chunks:
                stop_reason = 'trailing-silence'
                break

    if not speech_detected or not captured_chunks:
        print(
            'voice client: no speech detected '
            f'within {max_capture_seconds:.2f}s capture window '
            f'(noise_floor_rms={noise_floor_rms:.4f}, effective_threshold={effective_speech_threshold:.4f}).'
        )
        return {
            'audioPath': None,
            'debug': build_capture_debug_payload(
                'captured-audio',
                'no-speech-detected',
                False,
                min_capture_seconds,
                max_capture_seconds,
                trailing_silence_ms,
                speech_threshold,
                effective_speech_threshold,
                noise_floor_rms,
                preroll_ms,
                None,
            ),
        }

    output_path = Path(tempfile.gettempdir()) / f'alice-voice-client-{os.getpid()}-{int(time.time() * 1000)}.wav'
    write_wav_file(output_path, captured_chunks, sample_rate)

    captured_seconds = len(captured_chunks) * chunk_duration_seconds
    print(
        'voice client: captured '
        f'{captured_seconds:.2f}s of audio '
        f'({stop_reason}, configured_threshold={speech_threshold:.4f}, effective_threshold={effective_speech_threshold:.4f}, '
        f'noise_floor_rms={noise_floor_rms:.4f}, trailing_silence_ms={int(trailing_silence_ms)}).'
    )
    return {
        'audioPath': str(output_path),
        'debug': build_capture_debug_payload(
            'captured-audio',
            stop_reason,
            True,
            min_capture_seconds,
            max_capture_seconds,
            trailing_silence_ms,
            speech_threshold,
            effective_speech_threshold,
            noise_floor_rms,
            preroll_ms,
            captured_seconds,
        ),
    }


def capture_voice_turn(
    voice_plugin_config: dict,
    wake_word_detected_sound: Path | None,
    audio_capture_closed_sound: Path | None,
    continuation_mode: bool = False,
) -> dict:
    noise_floor_rms = sample_background_noise(voice_plugin_config)
    noise_floor_multiplier = 3.0
    max_effective_threshold: float | None = None

    if continuation_mode:
        settle_seconds = get_continuation_capture_settle_seconds(voice_plugin_config)
        if settle_seconds > 0:
            time.sleep(settle_seconds)

        # Continuation turns happen right after local TTS playback, so avoid over-inflating
        # the speech threshold from temporary speaker bleed into the ambient sample.
        noise_floor_multiplier = get_continuation_noise_floor_multiplier(voice_plugin_config)
        max_effective_threshold = (
            get_speech_threshold(voice_plugin_config)
            * get_continuation_threshold_cap_multiplier(voice_plugin_config)
        )

    try:
        capture_result = record_audio_clip(
            voice_plugin_config,
            noise_floor_rms,
            wake_word_detected_sound,
            noise_floor_multiplier=noise_floor_multiplier,
            max_effective_threshold=max_effective_threshold,
        )
    finally:
        play_optional_sound(audio_capture_closed_sound)

    report_voice_capture_debug(capture_result['debug'])
    return capture_result


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


def resolve_piper_model_path(system_config: dict) -> Path:
    piper_config = system_config.get('piperTts', {})
    configured_model = str(piper_config.get('model', '')).strip()
    if not configured_model:
        raise RuntimeError('piperTts.model is not configured.')

    model_path = Path(configured_model).expanduser()
    if not model_path.exists():
        raise RuntimeError(
            f'Configured Piper model file does not exist: {model_path}. '
            'Update piperTts.model to point to a real .onnx voice file installed on this machine.'
        )

    return model_path


def resolve_piper_config_path(model_path: Path) -> Path | None:
    candidates = [
        Path(f'{model_path}.json'),
        model_path.with_suffix('.json'),
    ]

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return None


def synthesize_speech_with_piper_module(text: str, system_config: dict, destination_path: str) -> None:
    piper_module = importlib.import_module('piper')
    PiperVoice = getattr(piper_module, 'PiperVoice')
    SynthesisConfig = getattr(piper_module, 'SynthesisConfig')

    piper_config = system_config.get('piperTts', {})
    model_path = resolve_piper_model_path(system_config)
    config_path = resolve_piper_config_path(model_path)

    voice = PiperVoice.load(model_path, config_path=config_path, use_cuda=False)
    synthesis_config = SynthesisConfig(speaker_id=piper_config.get('speaker'))

    with wave.open(destination_path, 'wb') as wav_file:
        wav_params_set = False
        for audio_chunk in voice.synthesize(text, synthesis_config):
            if not wav_params_set:
                wav_file.setframerate(audio_chunk.sample_rate)
                wav_file.setsampwidth(audio_chunk.sample_width)
                wav_file.setnchannels(audio_chunk.sample_channels)
                wav_params_set = True

            wav_file.writeframes(audio_chunk.audio_int16_bytes)


def synthesize_speech_with_system_piper(text: str, system_config: dict, destination_path: str) -> None:
    helper_python = os.environ.get('ALICE_PIPER_PYTHON', '/usr/bin/python3').strip() or '/usr/bin/python3'
    piper_config = system_config.get('piperTts', {})
    model_path = resolve_piper_model_path(system_config)
    config_path = resolve_piper_config_path(model_path)

    helper_script = """
import sys
import wave
from piper import PiperVoice, SynthesisConfig

text = sys.argv[1]
model_path = sys.argv[2]
config_path = sys.argv[3]
speaker_id = int(sys.argv[4])
destination_path = sys.argv[5]

voice = PiperVoice.load(model_path, config_path=config_path or None, use_cuda=False)
synthesis_config = SynthesisConfig(speaker_id=speaker_id)

with wave.open(destination_path, 'wb') as wav_file:
    wav_params_set = False
    for audio_chunk in voice.synthesize(text, synthesis_config):
        if not wav_params_set:
            wav_file.setframerate(audio_chunk.sample_rate)
            wav_file.setsampwidth(audio_chunk.sample_width)
            wav_file.setnchannels(audio_chunk.sample_channels)
            wav_params_set = True

        wav_file.writeframes(audio_chunk.audio_int16_bytes)
""".strip()

    subprocess.run([
        helper_python,
        '-c',
        helper_script,
        text,
        str(model_path),
        str(config_path or ''),
        str(int(piper_config.get('speaker', 0))),
        destination_path,
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def synthesize_speech_locally(text: str, system_config: dict, destination_path: str) -> None:
    last_error: Exception | None = None

    try:
        synthesize_speech_with_piper_module(text, system_config, destination_path)
        return
    except Exception as error:
        last_error = error

    try:
        synthesize_speech_with_system_piper(text, system_config, destination_path)
        return
    except Exception as error:
        last_error = error

    raise RuntimeError(f'Unable to synthesize speech locally with Piper: {last_error}')


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

    synthesize_speech_locally(text, system_config, str(destination_path))
    return str(destination_path)


def play_audio_file(audio_path: str) -> None:
    run_command(build_audio_playback_command(audio_path))


def play_optional_sound(sound_path: Path | None) -> None:
    if sound_path is None:
        return

    try:
        run_command(build_audio_playback_command(str(sound_path)))
    except Exception as error:
        print(f'voice client: failed to play optional sound {sound_path}: {error}')


def speak_text(text: str, system_config: dict) -> None:
    cleaned_text = text.strip()
    if not cleaned_text:
        return

    audio_path = synthesize_speech_to_temp_file(cleaned_text, system_config)
    try:
        play_audio_file(audio_path)
    finally:
        Path(audio_path).unlink(missing_ok=True)


def report_voice_capture_debug(capture_debug: dict) -> None:
    base_url = os.environ.get('ALICE_VOICE_BASE_URL', '').rstrip('/')
    token = os.environ.get('ALICE_VOICE_TOKEN', '')
    request = urllib.request.Request(
        f'{base_url}/api/voice/debug/capture',
        data=json.dumps(capture_debug).encode('utf-8'),
        headers={
            'content-type': 'application/json',
            'authorization': f'Bearer {token}',
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(request):
            return
    except Exception as error:
        if os.environ.get('ALICE_DEBUG', '').strip():
            print(f'voice client: failed to report capture debug payload: {error}')


def send_voice_turn(message: str) -> dict:
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

    end_conversation = response_json.get('endConversation')
    if not isinstance(end_conversation, bool):
        end_conversation = False

    continue_conversation = response_json.get('continueConversation')
    if not isinstance(continue_conversation, bool):
        continue_conversation = not end_conversation

    active_task_assistant = response_json.get('activeTaskAssistant')
    active_agents = response_json.get('activeAgents')

    return {
        'reply': reply,
        'endConversation': end_conversation,
        'continueConversation': continue_conversation,
        'activeTaskAssistant': active_task_assistant if isinstance(active_task_assistant, dict) else None,
        'activeAgents': active_agents if isinstance(active_agents, list) else [],
    }


def check_health() -> dict:
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

    return response_json


def fetch_set_aside_sessions() -> list[dict]:
    """Fetch set-aside voice sessions that can be resumed from the web UI."""
    base_url = os.environ.get('ALICE_VOICE_BASE_URL', '').rstrip('/')
    token = os.environ.get('ALICE_VOICE_TOKEN', '')
    request = urllib.request.Request(
        f'{base_url}/api/voice/set-aside-sessions',
        headers={
            'authorization': f'Bearer {token}',
        },
        method='GET',
    )

    try:
        with urllib.request.urlopen(request) as response:
            response_json = json.loads(response.read().decode('utf-8'))

        if not response_json.get('ok'):
            return []

        sessions = response_json.get('sessions')
        return sessions if isinstance(sessions, list) else []
    except Exception as error:
        print(f'voice client: failed to fetch set-aside sessions: {error}')
        return []


def fetch_voice_events(after_sequence: int) -> tuple[list[dict], int]:
    base_url = os.environ.get('ALICE_VOICE_BASE_URL', '').rstrip('/')
    token = os.environ.get('ALICE_VOICE_TOKEN', '')
    request = urllib.request.Request(
        f'{base_url}/api/voice/events?afterSequence={max(0, after_sequence)}',
        headers={
            'authorization': f'Bearer {token}',
        },
        method='GET',
    )

    with urllib.request.urlopen(request) as response:
        response_json = json.loads(response.read().decode('utf-8'))

    if not response_json.get('ok'):
        raise RuntimeError('Voice API events request did not return ok=true.')

    events = response_json.get('events')
    if not isinstance(events, list):
        events = []

    latest_sequence = response_json.get('latestSequence')
    if not isinstance(latest_sequence, int) or latest_sequence < 0:
        latest_sequence = after_sequence

    return events, latest_sequence


def process_voice_events(
    events: list[dict],
    after_sequence: int,
    system_config: dict,
    voice_plugin_config: dict,
    spoken_started: bool,
    spoken_completed: bool,
) -> tuple[int, bool, bool]:
    current_sequence = after_sequence
    started = spoken_started
    completed = spoken_completed

    for event in events:
        if not isinstance(event, dict):
            continue

        sequence = event.get('sequence')
        if isinstance(sequence, int) and sequence > current_sequence:
            current_sequence = sequence

        event_type = event.get('type')
        if event_type == 'archiving-started' and not started:
            speak_text(get_archiving_started_prompt(voice_plugin_config), system_config)
            started = True
        elif event_type == 'archiving-completed' and not completed:
            speak_text(get_archiving_completed_prompt(voice_plugin_config), system_config)
            completed = True

    return current_sequence, started, completed


def announce_archival_progress(after_sequence: int, system_config: dict, voice_plugin_config: dict) -> int:
    current_sequence = after_sequence
    spoken_started = False
    spoken_completed = False
    deadline = time.monotonic() + 15.0

    while time.monotonic() < deadline and not spoken_completed and not shutdown_requested:
        events, latest_sequence = fetch_voice_events(current_sequence)
        current_sequence, spoken_started, spoken_completed = process_voice_events(
            events,
            current_sequence,
            system_config,
            voice_plugin_config,
            spoken_started,
            spoken_completed,
        )
        current_sequence = max(current_sequence, latest_sequence)

        if spoken_completed:
            break

        time.sleep(0.2)

    return current_sequence


def notify_continuation_timeout() -> dict:
    """Notify the server that the continuation turn ended in silence.

    Returns a dict with:
      - closed_conversation: bool — whether a conversation was closed/set aside
      - set_aside: bool — whether the conversation was set aside (can be resumed later)
    """
    base_url = os.environ.get('ALICE_VOICE_BASE_URL', '').rstrip('/')
    token = os.environ.get('ALICE_VOICE_TOKEN', '')
    request = urllib.request.Request(
        f'{base_url}/api/voice/continue-timeout',
        data=b'{}',
        headers={
            'content-type': 'application/json',
            'authorization': f'Bearer {token}',
        },
        method='POST',
    )

    with urllib.request.urlopen(request) as response:
        response_json = json.loads(response.read().decode('utf-8'))

    closed_conversation = response_json.get('closedConversation')
    closed = bool(closed_conversation) if isinstance(closed_conversation, bool) else False

    # The server sets aside sessions on timeout rather than archiving them,
    # so a closed conversation means it was set aside for possible resume.
    return {
        'closed_conversation': closed,
        'set_aside': closed,
    }


def capture_transcript_from_microphone(
    voice_plugin_config: dict,
    wake_word_detected_sound: Path | None,
    audio_capture_closed_sound: Path | None,
    no_transcript_message: str,
    continuation_mode: bool = False,
) -> str | None:
    capture_result = capture_voice_turn(
        voice_plugin_config,
        wake_word_detected_sound,
        audio_capture_closed_sound,
        continuation_mode=continuation_mode,
    )
    audio_path = capture_result['audioPath']
    if audio_path is None:
        print(no_transcript_message)
        return None

    try:
        transcript = transcribe_audio_file(audio_path)
    finally:
        Path(audio_path).unlink(missing_ok=True)

    if not transcript:
        print(no_transcript_message)
        return None

    return transcript


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


def get_wake_word_reset_interval_seconds() -> float:
    try:
        return max(60.0, float(os.environ.get('ALICE_VOICE_WAKE_RESET_INTERVAL_SECONDS', '300').strip()))
    except ValueError:
        return 300.0


def wait_for_wake_word(
    system_config: dict,
    wake_model,
    np,
    sd,
    last_reset_time: float,
    reset_interval_seconds: float,
) -> float:
    """Listen for the wake word, returning the (possibly updated) last_reset_time.

    The model and timer are owned by the caller so they survive across
    detections. Without this, each conversation turn creates a fresh model
    and the periodic reset that prevents CPU creep never fires.
    """
    threshold = get_wake_threshold()
    chunk_size = 1280

    with sd.RawInputStream(samplerate=16000, channels=1, dtype='int16', blocksize=chunk_size) as stream:
        while not shutdown_requested:
            audio_chunk, overflowed = stream.read(chunk_size)

            # Check the reset timer before the overflow skip so that a
            # sustained overflow storm cannot starve the periodic reset.
            # Without this guard, high CPU from buffer bloat causes more
            # overflows, which skip the reset, which causes more bloat.
            now = time.monotonic()
            if now - last_reset_time >= reset_interval_seconds:
                wake_model.reset()
                last_reset_time = now
                print('voice client: reset wake word model buffers to prevent CPU creep.')

            if overflowed:
                # Brief yield so a sustained overflow storm doesn't tight-spin
                # the CPU and starve the audio callback thread.
                time.sleep(0.001)
                continue

            prediction_input = np.frombuffer(audio_chunk, dtype=np.int16)
            predict_start = time.monotonic()
            prediction = wake_model.predict(prediction_input)
            predict_elapsed = time.monotonic() - predict_start
            if predict_elapsed > 0.05:
                print(
                    f'voice client: predict() took {predict_elapsed * 1000:.1f}ms '
                    f'(threshold is 50ms); wake word model may be bloated.'
                )
            score = max((float(value) for value in prediction.values()), default=0.0)

            if score >= threshold:
                print(f'voice client: wake word detected with score {score:.3f}')
                return last_reset_time

    return last_reset_time


def run_manual_loop(system_config: dict, voice_plugin_config: dict, last_event_sequence: int) -> None:
    wake_word = os.environ.get('ALICE_VOICE_WAKE_WORD', system_config.get('wakeWord', 'Hey ALICE'))
    wake_word_detected_sound = get_optional_sound_path(voice_plugin_config, 'wakeWordDetectedSoundPath')
    audio_capture_closed_sound = get_optional_sound_path(voice_plugin_config, 'audioCaptureClosedSoundPath')
    print(f'ALICE voice client ready. Wake word configured as: {wake_word}')
    print('Manual dev mode: press Enter to record one turn, type text to send it directly, or type q to quit.')

    while not shutdown_requested:
        try:
            user_input = input('voice> ').strip()
        except EOFError:
            print('voice client: stdin closed, exiting.')
            return

        if user_input.lower() in {'q', 'quit', 'exit'}:
            print('voice client: exit requested.')
            return

        if user_input:
            report_voice_capture_debug(build_capture_debug_payload(
                'manual-text',
                'manual-text-input',
                True,
                get_min_capture_seconds(voice_plugin_config),
                get_max_capture_seconds(voice_plugin_config),
                get_trailing_silence_ms(voice_plugin_config),
                get_speech_threshold(voice_plugin_config),
                get_speech_threshold(voice_plugin_config),
                0.0,
                get_preroll_ms(voice_plugin_config),
                0.0,
            ))
            transcript = user_input
        else:
            capture_result = capture_voice_turn(
                voice_plugin_config,
                wake_word_detected_sound,
                audio_capture_closed_sound,
            )
            audio_path = capture_result['audioPath']
            if audio_path is None:
                print('voice client: no transcript detected.')
                continue

            try:
                transcript = transcribe_audio_file(audio_path)
            finally:
                Path(audio_path).unlink(missing_ok=True)

        if not transcript:
            print('voice client: no transcript detected.')
            continue

        print(f'user: {transcript}')
        turn_result = send_voice_turn(transcript)
        reply = turn_result['reply']
        print(f'ALICE: {reply}')

        speak_text(reply, system_config)

        if turn_result['endConversation']:
            last_event_sequence = announce_archival_progress(last_event_sequence, system_config, voice_plugin_config)


def run_wake_word_loop(system_config: dict, voice_plugin_config: dict, last_event_sequence: int) -> None:
    wake_word = os.environ.get('ALICE_VOICE_WAKE_WORD', system_config.get('wakeWord', 'Hey ALICE'))
    wake_word_detected_sound = get_optional_sound_path(voice_plugin_config, 'wakeWordDetectedSoundPath')
    audio_capture_closed_sound = get_optional_sound_path(voice_plugin_config, 'audioCaptureClosedSoundPath')
    print(f'ALICE voice client ready. Waiting for wake word: {wake_word}')

    np, sd, Model = import_wake_word_runtime()
    model_path = get_open_wake_word_model_path(system_config)
    wake_model = create_wake_word_model(Model, model_path)
    reset_interval_seconds = get_wake_word_reset_interval_seconds()
    last_reset_time = time.monotonic()

    while not shutdown_requested:
        last_reset_time = wait_for_wake_word(
            system_config,
            wake_model,
            np,
            sd,
            last_reset_time,
            reset_interval_seconds,
        )

        transcript = capture_transcript_from_microphone(
            voice_plugin_config,
            wake_word_detected_sound,
            audio_capture_closed_sound,
            'voice client: no transcript detected after wake word.',
        )
        if transcript is None:
            continue

        while not shutdown_requested:
            print(f'user: {transcript}')
            turn_result = send_voice_turn(transcript)
            reply = turn_result['reply']
            print(f'ALICE: {reply}')
            speak_text(reply, system_config)

            # Log task assistant and agent activity if present
            active_task_assistant = turn_result.get('activeTaskAssistant')
            if active_task_assistant:
                print(f'voice client: task assistant active: {active_task_assistant.get("name", "unknown")}')

            active_agents = turn_result.get('activeAgents', [])
            if active_agents:
                agent_names = ', '.join(agent.get('agentName', 'unknown') for agent in active_agents)
                print(f'voice client: agents active: {agent_names}')

            if turn_result['endConversation']:
                last_event_sequence = announce_archival_progress(last_event_sequence, system_config, voice_plugin_config)
                break

            transcript = capture_transcript_from_microphone(
                voice_plugin_config,
                wake_word_detected_sound,
                audio_capture_closed_sound,
                'voice client: no follow-up transcript detected during continuation.',
                continuation_mode=True,
            )
            if transcript is not None:
                continue

            print('voice client: no follow-up transcript detected during continuation; setting conversation aside.')
            timeout_result = notify_continuation_timeout()
            if timeout_result.get('closed_conversation'):
                if timeout_result.get('set_aside'):
                    # Session was set aside — it can be resumed from the web UI later
                    speak_text(get_continuation_silence_prompt(voice_plugin_config), system_config)
                else:
                    # Session was archived immediately
                    speak_text(get_continuation_silence_prompt(voice_plugin_config), system_config)
                    last_event_sequence = announce_archival_progress(last_event_sequence, system_config, voice_plugin_config)
            break


def main() -> int:
    try:
        configure_runtime_warnings()
        system_config = load_system_config()
        voice_plugin_config = load_voice_plugin_config()
        health_response = check_health()
        last_event_sequence = health_response.get('latestEventSequence', 0)
        if not isinstance(last_event_sequence, int) or last_event_sequence < 0:
            last_event_sequence = 0

        # Log set-aside session info from the health check
        set_aside_count = health_response.get('setAsideSessionCount')
        if isinstance(set_aside_count, int) and set_aside_count > 0:
            print(f'voice client: {set_aside_count} set-aside voice session(s) available for resume via web UI.')

        active_agent_count = health_response.get('activeAgentCount')
        if isinstance(active_agent_count, int) and active_agent_count > 0:
            print(f'voice client: {active_agent_count} active agent(s) running.')
        if os.environ.get('ALICE_VOICE_MANUAL', '').strip() == '1':
            run_manual_loop(system_config, voice_plugin_config, last_event_sequence)
        else:
            run_wake_word_loop(system_config, voice_plugin_config, last_event_sequence)
        return 0
    except KeyboardInterrupt:
        return 0
    except urllib.error.HTTPError as error:
        sys.stderr.write(f'voice client HTTP error: {error.code} {error.reason}\n')
        return 1
    except Exception as error:
        sys.stderr.write(f'voice client failed: {error}\n')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
