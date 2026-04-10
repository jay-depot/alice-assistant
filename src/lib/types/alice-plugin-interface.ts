import { TSchema } from 'typebox';
import { DynamicPrompt } from '../dynamic-prompt.js';
import { Tool } from '../tool-system.js';
import { SystemConfigFull } from './system-config-full.js';
import { AlicePluginHooks } from './alice-plugin-hooks.js';
import { ConversationTypeDefinition, ConversationTypeId } from '../conversation-types.js';

type AlicePluginDependency = {
  id: string;
  /**
   * Semver range
   */
  version: string;
};

export type AlicePluginMetadata = {
  // the plugin's unique identifier. Package name, usually.
  id: string;
  // The plugin's human-friendly name, used in the UI and error messages. Does not have to be unique, but it should be.
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

export type UIRegion =
  | 'sidebar-top'
  | 'sidebar-bottom'
  | 'chat-header'
  | 'message-prefix'
  | 'message-suffix'
  | 'input-prefix'
  | 'settings-panel';

export type AliceUiScriptRegistration = {
  id: string;
  scriptUrl: string;
};

declare module './alice-plugin-interface.js' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface PluginCapabilities {}
};

export type AlicePluginInterface = {
  registerPlugin: () => Promise<{
    registerTool: (toolDefinition: Tool) => void;

    // Let's limit non-system plugins to only being able to give their system prompts
    // a positive weight, for now.
    registerHeaderSystemPrompt: (promptDefinition: DynamicPrompt) => void;
    // And for footer weights, nothing higher than 9999 unless you're a system plugin.
    registerFooterSystemPrompt: (promptDefinition: DynamicPrompt) => void;

    registerConversationType: (conversationTypeDefinition: ConversationTypeDefinition) => void;

    addToolToConversationType: (conversationTypeId: ConversationTypeId, pluginId: string, toolName: string) => void;

    hooks: AlicePluginHooks;

    // This function tells the plugin system to create or load the config 
    // file for this plugin from the default location, which is 
    // `[CONFIG_DIR]/plugin-settings/[PLUGIN_NAME]/[PLUGIN_NAME].json`. 
    // If you provide a validation schema, the plugin system will validate 
    // the config against it and throw an error if it doesn't match.
    config: <T extends Record<string, unknown>>(validationSchema: TSchema, defaultConfig: T) => Promise<{
      getPluginConfig: () => T;
      // updatePluginConfig: (newConfig: unknown) => Promise<Type.Static<T>>;
      getSystemConfig(): SystemConfigFull,
    }>;

    /**
     * Use this function to offer an API to any plugins that declare a dependency on your plugin.
     * 
     * A plugin may only call `offer` once, and may only call it during its registration callback.
     * The plugin system will throw an error if a plugin violates either of these rules, with 
     * an error message that tells the user which plugin to disable to fix their assistant.
     * 
     * @param capabilities: An object containing the methods and properties the plugin would 
     *                      like to expose to dependencies.
     * @returns void
     */
    offer: <T extends keyof PluginCapabilities>(capabilities: PluginCapabilities[T]) => void;

    /**
     * Request the offered API of a plugin on which this plugin has declared a dependency. The 
     * plugin system will throw an error if this function is called for a plugin that is not 
     * declared as a dependency, even if that plugin is a required system plugin.
     * 
     * @param pluginName The name of the plugin whose offered API you want to use.
     * @returns The offered API of the requested plugin, or undefined if the plugin does not offer any API.
     */
    request: <T extends keyof PluginCapabilities>(pluginName: T) => PluginCapabilities[T] | undefined;
  }>;
};

export type AlicePlugin = {
  pluginMetadata: AlicePluginMetadata;
  registerPlugin: (api: AlicePluginInterface) => Promise<void>;
}
