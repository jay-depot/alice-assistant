import { Static, TSchema } from '@sinclair/typebox';
import { Conversation } from './conversation.js';
import { DynamicPrompt, DynamicPromptConversationType } from './dynamic-prompt.js';
import { Tool } from './tool-system.js';

export type AlicePluginMetadata = {
  name: string;
  version: string; // semver enforces. System plugins, AND ONLY SYSTEM PLUGINS, can use the magic version string "LATEST" to always match the assistant's version.
  description: string;
  system?: boolean; // Whether this plugin is a "system" plugin, which can modify the assistant's system prompts and has access to more powerful tools. Only set this to true if you are sure you know what you're doing.
  required?: boolean; // Whether this plugin is required for the assistant to function. If a required plugin fails to load, the assistant should not start.
  dependencies?: string[]; // An array of plugin names that this plugin depends on. The plugin system will ensure that these plugins are loaded before this one. If any dependencies are missing or fail to load, the assistant should not start.
};

export type AlicePluginInterface = {
  registerPlugin: (pluginDefinition: AlicePluginMetadata) => Promise<{
    registerTool: (toolDefinition: Tool) => void;

    // Let's limit non-system plugins to only being able to give their system prompts
    // a positive weight, for now.
    registerHeaderSystemPrompt: (promptDefinition: DynamicPrompt) => void;
    // And for footer weights, nothing higher than 9999 unless you're a system plugin.
    registerFooterSystemPrompt: (promptDefinition: DynamicPrompt) => void;

    hooks: {
      onUserConversationWillBegin: (callback: (conversation: Conversation, type: DynamicPromptConversationType) => Promise<void>) => void;
      onUserConversationWillEnd: (callback: (conversation: Conversation, type: DynamicPromptConversationType) => Promise<void>) => void;
      onAssistantStartup: (callback: () => Promise<void>) => void;
    };
    // This function tells the plugin system to create or load the config 
    // file for this plugin from the default location, which is 
    // `[CONFIG_DIR]/plugin-settings/[PLUGIN_NAME]/[PLUGIN_NAME].json`. 
    // If you provide a validation schema, the plugin system will validate 
    // the config against it and throw an error if it doesn't match.
    config: <T extends TSchema>(validationSchema: T) => Promise<{
      getPluginConfig: () => Static<T>;
      updatePluginConfig: (newConfig: Static<T>) => Promise<Static<T>>;
      getSystemConfig(): any, // any is temporary until the system config gets type enforcement
    }>;
  }>;
};

export type AlicePlugin = {
  pluginMetadata: AlicePluginMetadata;
  registerPlugin: (alicePluginSystem: AlicePluginInterface) => Promise<void>;
}
