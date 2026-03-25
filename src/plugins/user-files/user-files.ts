import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

declare module '../../lib/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    'user-files': {
      // Question: What happens if two plugins can handle the same file type?
      registerFileTypeTextHandler: (fileTypes: string[], callback: (filePath: string) => Promise<string>) => void;

      // This API call's conventions are TBD, but the intention is to allow plugins to register 
      // handlers for images that feed the image directly to the model if it's a vision-language 
      // model. May fall back on sending the image to a separate vision model for description.
      registerFileTypeVisionHandler: (fileTypes: string[], callback: (filePath: string) => Promise<Buffer>) => void;

      getAllowedFilePaths: () => Promise<string[]>;

      /**
       * 
       * @returns An array containing all of the file extensions registered by file type handler 
       *          plugins.
       */
      getPossibleFileTypes: () => Promise<string[]>;
      getAllowedFileTypes: () => Promise<string[]>;
    }
  }
};

const userFilesPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'user-files',
    name: 'User Files Plugin',
    description: 'Provides the assistant with tools to read the user\'s filesystem, ' +
      'within limits set by the user in the plugin configuration. Does not allow the ' +
      'assistant to access hidden files or folders, and does not allow the assistant to ' +
      'access any files or folders outside of the user-specified allowed folders or file types.',
    version: 'LATEST',
    dependencies: [],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(userFilesPlugin.pluginMetadata);
  }
};

export default userFilesPlugin;
