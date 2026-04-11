/**
 * Tries to convert markdown characters into something that works better in TTS.
 * 
 * Since we use piper, our tools basically consist of turning things into dashes to get pauses.
 * 
 * Add more rules to this as I run into more issues with markdown in TTS.
 */
export function markdownToTts(text: string): string {
  // Replace markdown characters with dashes to create pauses for TTS
  return text.replace(/[*_~`]/g, '-');
}
