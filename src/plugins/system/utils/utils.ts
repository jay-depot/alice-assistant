import type { AlicePlugin } from '../../../lib.js';
import { evaluateArithmeticTool } from './tools/evaluate-arithmetic.js';
import { countWordsTool } from './tools/count-words.js';
import { countLettersTool } from './tools/count-letters.js';
import { countCharactersTool } from './tools/count-characters.js';
import { countLinesTool } from './tools/count-lines.js';
import { countUniqueWordsTool } from './tools/count-unique-words.js';
import { countSentencesParagraphsTool } from './tools/count-sentences-paragraphs.js';
import { spellTool } from './tools/spell.js';

const utilsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'utils',
    name: 'Utils Plugin',
    brandColor: '#3b9bd6',
    description:
      'Provides deterministic utility tools for arithmetic and text metrics where exactness matters.',
    version: 'LATEST',
    dependencies: [],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    plugin.registerTool(evaluateArithmeticTool());
    plugin.registerTool(countWordsTool());
    plugin.registerTool(countLettersTool());
    plugin.registerTool(countCharactersTool());
    plugin.registerTool(countLinesTool());
    plugin.registerTool(countUniqueWordsTool());
    plugin.registerTool(countSentencesParagraphsTool());
    plugin.registerTool(spellTool());
  },
};

export default utilsPlugin;
