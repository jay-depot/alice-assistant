import { Type } from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import findUserFilesTool from './tools/find-user-files.js';
import getDirectoryListingTool from './tools/get-directory-listing.js';
import readUserTextFileTool from './tools/read-user-text-file.js';
import writeUserTextFileTool from './tools/write-user-text-file.js';

const UserFilesPluginConfigSchema = Type.Object(
  {
    allowedFilePaths: Type.Array(Type.String(), { default: [] }),
    allowedFileTypesReadOnly: Type.Array(Type.String(), { default: [] }),
    allowedFileTypesWrite: Type.Array(Type.String(), { default: [] }),
    maxFileSizeBytes: Type.Number({ default: 10485760, minimum: 1 }),
  },
  {
    description:
      'Configuration for the user files plugin. Allows the user to specify ' +
      'which file paths and file types the assistant is allowed to access. If left empty, ' +
      'the assistant will not be able to access any files.',
  }
);

export type UserFilesPluginConfigSchema = Type.Static<
  typeof UserFilesPluginConfigSchema
>;
declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'user-files': {
      // Question: What happens if two plugins can handle the same file type?
      registerFileTypeTextHandler: (
        fileTypes: string[],
        callback: (filePath: string) => Promise<string>
      ) => void;

      // This API call's conventions are TBD, but the intention is to allow plugins to register
      // handlers for images that feed the image directly to the model if it's a vision-language
      // model. May fall back on sending the image to a separate vision model for description.
      registerFileTypeVisionHandler: (
        fileTypes: string[],
        callback: (filePath: string) => Promise<Buffer>
      ) => void;

      getAllowedFilePaths: () => Promise<string[]>;

      /**
       *
       * @returns An array containing all of the file extensions registered by file type handler
       *          plugins.
       */
      getPossibleFileTypes: () => Promise<string[]>;
      getAllowedFileTypesForReadOnly: () => Promise<string[]>;
      getAllowedFileTypesForWrite: () => Promise<string[]>;
    };
  }
}

type FileHandlerText = {
  handlerType: 'text';
  types: string[];
  callback: (filePath: string) => Promise<string>;
};

type FileHandlerVision = {
  handlerType: 'vision';
  types: string[];
  callback: (filePath: string) => Promise<Buffer>;
};

type FileHandler = FileHandlerText | FileHandlerVision;

const userFilesPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'user-files',
    name: 'User Files Plugin',
    brandColor: '#48b34e',
    description:
      "Provides the assistant with tools to read the user's filesystem, " +
      'within limits set by the user in the plugin configuration. Does not allow the ' +
      'assistant to access hidden files or folders, and does not allow the assistant to ' +
      'access any files or folders outside of the user-specified allowed folders or file types.',
    version: 'LATEST',
    dependencies: [{ id: 'credential-store', version: 'LATEST' }],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config(UserFilesPluginConfigSchema, {
      allowedFilePaths: [],
      allowedFileTypesReadOnly: [],
      allowedFileTypesWrite: [],
      maxFileSizeBytes: 10485760,
    });

    const handlers: FileHandler[] = [];

    plugin.offer<'user-files'>({
      getAllowedFilePaths: async () => {
        return config.getPluginConfig().allowedFilePaths;
      },

      getAllowedFileTypesForReadOnly: async () => {
        return config.getPluginConfig().allowedFileTypesReadOnly;
      },

      getAllowedFileTypesForWrite: async () => {
        return config.getPluginConfig().allowedFileTypesWrite;
      },

      getPossibleFileTypes: async () => {
        const possibleFileTypes = new Set<string>();

        handlers.forEach(handler => {
          handler.types.forEach(type => possibleFileTypes.add(type));
        });

        return Array.from(possibleFileTypes);
      },

      registerFileTypeTextHandler: async (fileTypes, callback) => {
        // Implementation for registering text file handlers
        handlers.push({
          handlerType: 'text',
          types: fileTypes,
          callback,
        });
      },

      registerFileTypeVisionHandler: async (fileTypes, callback) => {
        // Implementation for registering vision file handlers
        handlers.push({
          handlerType: 'vision',
          types: fileTypes,
          callback,
        });
      },
    });

    // Register tools after that here:
    plugin.registerTool(findUserFilesTool(config.getPluginConfig()));
    plugin.registerTool(getDirectoryListingTool(config.getPluginConfig()));

    // Get the secrets redactor from the credential-store plugin
    const credentialStore = plugin.request('credential-store');
    const redactor = await credentialStore.getRedactor();

    plugin.registerTool(
      readUserTextFileTool(config.getPluginConfig(), redactor)
    );
    plugin.registerTool(writeUserTextFileTool(config.getPluginConfig()));
  },
};

export default userFilesPlugin;
