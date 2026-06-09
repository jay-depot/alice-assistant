export const SUMMARY_HEADER = '# Summary of earlier conversation:\n';
export const SUMMARY_PROMPT =
  `Summarize the following conversation between the user and the ` +
  `assistant in a way that preserves all relevant information and details, but is as ` +
  `concise as possible. The summary should be in bullet point format, with each bullet ` +
  `point representing a single turn in the conversation. Be sure to include all ` +
  `relevant details and information from the conversation, but remove any fluff ` +
  `or filler content. Be especially certain to include any proper names, tasks with ` +
  `their statuses, and code samples, if applicable, in your summary. The summary will ` +
  `be used to provide context for future conversation turns, so it should be as ` +
  `informative as possible while still being concise.` +
  `\n\nConversation:\n\n`;

/**
 * Checks an LLM response for degenerate patterns and throws if found.
 *
 * - Long chains of the same repeating pattern (21+ consecutive repetitions of the same word).
 * - Broken tool calls where the tool name, garbage characters, and JSON arguments
 *   are dumped in the content field instead of the proper tool_calls field.
 */
export function checkLLMResponseForDegeneracy(response: string) {
  // We want to fail on the following, and force a retry:
  // - Long chains of the same repeating pattern.
  if (/(\b\w+\b)(?:\s+\1\b){20,}/.test(response)) {
    throw new Error(
      'LLM response appears to be degenerate (repeating pattern detected). Response: ' +
        response
    );
  }
  // - Broken tool calls.
  // Ollama tool calls specifically like to fail by dumping the tool name, a couple random unicode
  // characters, and then the tool arguments all as one big blob of text in the content field,
  // without properly populating the tool_calls field.
  // The pattern is something like this: TOOLNAME [GARBAGE_CHARACTERS] {JSON-STRINGIFIED-ARGUMENTS}
  // eslint-disable-next-line no-control-regex
  if (/([A-Za-z0-9_]+)\s*[\u0000-\u001F\u007F-\uFFFF]+({.*})/.test(response)) {
    throw new Error(
      'LLM response appears to be degenerate (tool call appears to be dumped in content field with garbage characters). Response: ' +
        response
    );
  }
}
