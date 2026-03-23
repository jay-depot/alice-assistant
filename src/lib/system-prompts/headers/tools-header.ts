import { getTools } from '../../../tools/index.js';
import { DynamicPrompt } from '../../dynamic-prompt.js';

export const toolsHeaderPrompt: DynamicPrompt = {
  name: 'toolsHeader',
  weight: 10,
  getPrompt: async (context): Promise<string | false> => {
      // Then the TOOLS section, which will list the tools that the assistant has access to, and how to use them.
    const tools = getTools();
    if (tools.length > 0) {
      const systemPromptChunks: string[] = [];
      systemPromptChunks.push(`# TOOLS\n\nYou have access to tools that can: retrieve local and remote data, perform actions on the user's system. RULES — follow these EXACTLY:\n`);
      for (let i = 0; i < tools.length; i++) {
        const tool = tools[i];
        const fragment = typeof tool.systemPromptFragment === 'function' ? tool.systemPromptFragment() : tool.systemPromptFragment;
        systemPromptChunks.push(` ${i +1} ${fragment}`);
      }
      return systemPromptChunks.join('\n');
    }
    return false;
  }
}
