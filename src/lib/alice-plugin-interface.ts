import { Static, TSchema } from '@sinclair/typebox';
import { Conversation } from './conversation.js';
import { DynamicPrompt, DynamicPromptConversationType } from './dynamic-prompt.js';
import { Tool } from './tool-system.js';

type AlicePluginDependency = {
  name: string;
  version: string | string[];
};

export type AlicePluginMetadata = {
  name: string;
  // semver enforced. System plugins, AND ONLY SYSTEM PLUGINS, can use the magic version 
  // string "LATEST" to always match the assistant's version.
  version: string; 
  description: string;
  // Whether this plugin is a "system" plugin. Really this just means it's loaded early, 
  // and can be marked 'required'.
  // Realistically, we should find a way to make this field not exist in the type definitions for 
  // external plugins.
  system?: boolean; 
  // Whether this system plugin is required for the assistant to function. If a required plugin 
  // fails to load, the assistant should not start. Non-system plugins cannot be required. Any 
  // non-system plugin that is marked as required will be assumed to be someone trying "funny 
  // business" (i.e. an attempt to push malware) and will raise a fatal error on startup.
  // The `required` field should somehow not be offered in the type definitions that external 
  // plugins see, either. TBD how to pull that off.
  required?: boolean;
  // The plugin system will ensure that these plugins are loaded before this one. If any 
  // dependencies are missing or fail to load, the assistant will not start, and will output 
  // an error message explaining how to get going again.
  dependencies?: AlicePluginDependency[]; 
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
      onAssistantShutdown: (callback: () => Promise<void>) => void;
      onToolWillBeCalled: (callback: (tool: Readonly<Tool>, args: Readonly<Record<string, unknown>>) => Promise<void>) => void;
      onToolWasCalled: (callback: (tool: Readonly<Tool>, args: Readonly<Record<string, unknown>>, result: string) => Promise<void>) => void;
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
  registerPlugin: (api: AlicePluginInterface) => Promise<void>;
}
