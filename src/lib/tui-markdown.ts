/**
 * Markdown-to-terminal renderer for the A.L.I.C.E. TUI.
 *
 * Uses marked-terminal to convert markdown content into ANSI-formatted
 * terminal output suitable for display in blessed widgets.
 */

import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

// Configure marked with the terminal renderer once.
marked.setOptions({
  renderer: new TerminalRenderer({
    width: 80,
    showSectionPrefix: false,
    tab: 2,
  }),
});

/**
 * Render a markdown string to ANSI-formatted terminal output.
 */
export function renderMarkdown(text: string): string {
  try {
    return marked.parse(text) as string;
  } catch {
    // If markdown rendering fails, return the raw text.
    return text;
  }
}
