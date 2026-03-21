import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { captureAndTranscribe } from './stt.js';
import { startLLMTransaction } from './llm-transaction.js';
import { buildSystemPrompt } from './system-prompt.js';
import { speakText } from './tts.js';

export async function runSingleVoiceTurn(recordSeconds = 7): Promise<void> {
  console.log(`Listening for up to ${recordSeconds} seconds...`);
  const transcript = await captureAndTranscribe(recordSeconds);

  if (!transcript) {
    console.log('No transcript detected.');
    return;
  }

  console.log(`User said: ${transcript}`);

  const conversation = startLLMTransaction();
  const prompt = await buildSystemPrompt('voice', transcript);
  const reply = await conversation.executeTurn(prompt);

  console.log(`ALICE: ${reply}`);
  await speakText(reply);
}

export async function runManualVoiceDemoLoop(): Promise<void> {
  const rl = createInterface({ input, output });
  console.log('Voice demo mode enabled. Press Enter to record a turn, or type "q" to quit.');

  try {
    while (true) {
      const command = (await rl.question('> ')).trim().toLowerCase();
      if (command === 'q' || command === 'quit' || command === 'exit') {
        break;
      }

      try {
        await runSingleVoiceTurn();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Voice turn failed: ${message}`);
      }
    }
  } finally {
    rl.close();
  }
}
