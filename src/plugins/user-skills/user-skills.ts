import path from 'path';
import { AlicePlugin } from '../../lib.js';
import Type from 'typebox';
import { exists } from '../../lib/node/fs-promised.js';
import { mkdir, readdir } from 'fs/promises';

const UserSkillsPluginConfigSchema = Type.Object({});

const userSkillsPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'user-skills',
    name: 'User Skills Plugin',
    description: 'Allows users to define custom skills for the assistant. This plugin provides an ' +
      'interface for users to create, manage, and delete their own skills, which are discrete pieces ' +
      'of information or instructions that the assistant can recall and use when relevant. ' +
      'User-defined skills can be used to teach the assistant about the user\'s preferences, ' +
      'routines, or any other information that might help it assist the user better.',
    version: 'LATEST',
    dependencies: [
      { id: "skills", version: "LATEST" },
    ],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();

    const config = await plugin.config(UserSkillsPluginConfigSchema, {});
    const systemConfig = config.getSystemConfig()
    const userSkillsDirectory = path.join(systemConfig.configDirectory, 'plugin-settings', 'user-skills', 'skills');
    const { registerSkillFile } = plugin.request('skills');

    if (await exists(userSkillsDirectory)) {
      const skillFiles = await readdir(userSkillsDirectory);
      for (const skillFile of skillFiles) {
        if (skillFile.endsWith('.md') && !skillFile.startsWith('.')) {
          registerSkillFile(path.join(userSkillsDirectory, skillFile));
        }
      }
    } else {
      await mkdir(userSkillsDirectory, { recursive: true });
    }
  },
};

export default userSkillsPlugin;
