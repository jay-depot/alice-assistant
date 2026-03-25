import { Static, TSchema } from '@sinclair/typebox';
import { Conversation } from './conversation.js';
import { DynamicPrompt, DynamicPromptConversationType } from './dynamic-prompt.js';
import { Tool } from './tool-system.js';
import { AlicePlugin, AlicePluginInterface, AlicePluginMetadata, PluginCapabilities } from './types/alice-plugin-interface.js'
import { UserConfig } from './user-config.js';
import { SystemConfigFull } from './types/system-config-full.js';

const loadedPlugins: AlicePlugin[] = [];
const registeredPlugins: Record<string, AlicePlugin> = {};

function createPluginInterface(pluginMetadata: AlicePluginMetadata): AlicePluginInterface {
  return {
    registerPlugin: async (pluginDefinition: AlicePluginMetadata) => {
      // TODO: Parse the given metadata for dependencies, and wait for them to be loaded before 
      // returning the plugin interface.
      
      return {
        registerTool: (toolDefinition: Tool) => {},
        registerHeaderSystemPrompt: (promptDefinition: DynamicPrompt) => {},
        registerFooterSystemPrompt: (promptDefinition: DynamicPrompt) => {},
        hooks: {
          onUserConversationWillBegin: (callback: (conversation: Conversation, type: DynamicPromptConversationType) => Promise<void>) => {},
          onUserConversationWillEnd: (callback: (conversation: Conversation, type: DynamicPromptConversationType) => Promise<void>) => {},
          onToolWillBeCalled: (callback: (tool: Readonly<Tool>, args: Readonly<Record<string, unknown>>) => Promise<void>) => {},
          onToolWasCalled: (callback: (tool: Readonly<Tool>, args: Readonly<Record<string, unknown>>, result: string) => Promise<void>) => {},
          onSystemPluginsLoaded: (callback: () => Promise<void>) => {},
          onUserPluginsWillLoad: (callback: () => Promise<void>) => {},
          onAllPluginsLoaded: (callback: () => Promise<void>) => {},
          onAssistantWillAcceptRequests: (callback: () => Promise<void>) => {},
          onAssistantAcceptsRequests: (callback: () => Promise<void>) => {},
          onAssistantWillStopAcceptingRequests: (callback: () => Promise<void>) => {},
          onAssistantStoppedAcceptingRequests: (callback: () => Promise<void>) => {},
          onPluginsWillUnload: (callback: () => Promise<void>) => {},
          onUserPluginsUnloaded: (callback: () => Promise<void>) => {},
          onSystemPluginsWillUnload: (callback: () => Promise<void>) => {},
        },
        offer<T extends keyof PluginCapabilities>(capabilities: PluginCapabilities[T]): void {},
        request<T extends keyof PluginCapabilities>(pluginID: T): PluginCapabilities[T] {
          return {} as PluginCapabilities[T];
        },
        config: async <T extends TSchema>(schema: T) => {
          return {
            getPluginConfig: () => {
              // For now, we'll just return an empty object, but in the future this will load 
              // the config from disk and validate it against the provided schema.
              return {} as Static<T>;
            },
            updatePluginConfig(newConfig) {
              // Eventually, this will validate and save the new config to disk before returning.
              return Promise.resolve(newConfig);
            },
            getSystemConfig() {
              return UserConfig.getConfig() as SystemConfigFull;
            },
          }
        }
      };
    }
  };
}

export const AlicePluginEngine = {
  /**
   * Blindly inserts the provided plugin into the plugin engine. Only use before calling init.
   * Caller is responsible for ensuring the plugin is valid and does not conflict with any 
   * other loaded plugins, and this will not throw until init is called otherwise.
   * 
   * Plugins' registration callbacks will be called by `init` in the order in which the plugins 
   * were inserted with this function.
   * @param plugin The plugin to insert into the plugin engine.
   */
  insertPlugin: async (plugin: AlicePlugin) => {
    loadedPlugins.push(plugin);
  },

  init: async () => {
    // 1. Validate plugins and their dependencies, and throw if any problems are found.
    loadedPlugins.forEach(plugin => {
      // check for duplicate plugin ids
      const duplicate = loadedPlugins.find(p => p.pluginMetadata.id === plugin.pluginMetadata.id);
      if (duplicate) {
        throw new Error(`Duplicate plugin id found: ${plugin.pluginMetadata.id}. Please remove one of the plugins with this id to continue.`);
      }

      // check for missing dependencies
      plugin.pluginMetadata.dependencies?.forEach(dependency => {
        // TODO: Version checking.
        const found = loadedPlugins.find(p => p.pluginMetadata.id === dependency.id);
        if (!found) {
          throw new Error(`Plugin ${plugin.pluginMetadata.id} is missing dependency: ${dependency.id}. Please add and enable ${dependency.id}, or disable ${plugin.pluginMetadata.id} to continue.`);
        }
      });
    });
    // 2. Call the registration callback for each plugin.
    await Promise.all(loadedPlugins.map(async plugin => {
      console.log(`Registering plugin: ${plugin.pluginMetadata.id}...`);
      await plugin.registerPlugin(createPluginInterface(plugin.pluginMetadata));
      registeredPlugins[plugin.pluginMetadata.id] = plugin;
      console.log(`Plugin registered: ${plugin.pluginMetadata.id}`);
    }));
    // 3. Plugin should call `api.registerPlugin` early in the registration callback.
    // 4. Engine receives the registration call, and checks for any dependencies. If 
    //    any are not loaded yet, the promise is held until they are. Otherwise, resolve 
    //    the promise with the plugin interface for that plugin.
    // 5. Once the promise resolves, the plugin can call the plugin interface functions to
    //    register tools, system prompts, and hooks.
    // 6. Once the plugin's registration callback resolves, we consider the plugin loaded, 
    //    and can continue loading any of its dependencies.
    // 7. Once all plugins are loaded, call any `onAllPluginsLoaded` hooks, and this
    //    function can return.
  },

  // Future plans:
  // hotLoadPlugin: async (plugin: AlicePlugin) => {},
  // unloadPlugin: async (pluginId: string) => {},
}
