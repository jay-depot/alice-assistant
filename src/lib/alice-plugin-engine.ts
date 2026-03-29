import { Static, TSchema } from '@sinclair/typebox';
import { DynamicPrompt } from './dynamic-prompt.js';
import { Tool } from './tool-system.js';
import { AlicePlugin, AlicePluginInterface, AlicePluginMetadata, PluginCapabilities } from './types/alice-plugin-interface.js'
import { UserConfig } from './user-config.js';
import { SystemConfigFull } from './types/system-config-full.js';
import { PluginHooks } from './plugin-hooks.js';
import { addHeaderPrompt } from './header-prompts.js';
import { addFooterPrompt } from './footer-prompts.js';
import { addTool } from './tools.js';

const loadedPlugins: AlicePlugin[] = [];
const registeredPlugins: Record<string, AlicePlugin> = {};
const registeredHeaderPromptNames: Record<string, string> = {};
const registeredFooterPromptNames: Record<string, string> = {};
const registeredToolNames: Record<string, string> = {};

const pluginCapabilities = {} as PluginCapabilities;
const loadingPromises: Record<string, { 
  promise: Promise<void>, 
  resolve: () => void, 
  reject: (error: any) => void,
}> = {};

function createPluginInterface(pluginMetadata: AlicePluginMetadata): AlicePluginInterface {
  return {
    registerPlugin: async (pluginDefinition: AlicePluginMetadata) => {
      const dependencyIds = pluginDefinition.dependencies?.map(dep => dep.id) || [];      
      const dependencyPromises = dependencyIds.map(depId => loadingPromises[depId].promise);

      await Promise.all(dependencyPromises);

      return {
        registerTool: (toolDefinition: Tool) => {
          if (registeredToolNames[toolDefinition.name]) {
            throw new Error(`Plugin ${pluginMetadata.id} attempted to register a tool with name ` +
              `"${toolDefinition.name}", but that name is already registered by plugin ` +
              `${registeredToolNames[toolDefinition.name]}. Disable one of these plugins to fix ` +
              `your assistant. If you are developing one of these plugins, change the name of ` +
              `this tool.`);
          }

          registeredToolNames[toolDefinition.name] = pluginMetadata.id;
          addTool(toolDefinition);
        },

        registerHeaderSystemPrompt: (promptDefinition: DynamicPrompt) => {
          if (!pluginMetadata.system) {
            const minWeight = 0;
            const maxWeight = 9999;
            if (promptDefinition.weight < minWeight || promptDefinition.weight > maxWeight) {
              throw new Error(`Plugin ${pluginMetadata.id} attempted to register a header system prompt with ` +
                `invalid weight ${promptDefinition.weight}. Non-system plugins may only register header system ` +
                `prompts with weights between 0 and 9999. Disable ${pluginMetadata.id} to fix your assistant, ` +
                `or change the weight of this prompt if you are developing this plugin.`);
            }
          }

          if (registeredHeaderPromptNames[promptDefinition.name]) {
            throw new Error(`Plugin ${pluginMetadata.id} attempted to register a header system prompt with ` +
              `name "${promptDefinition.name}", but that name is already registered by plugin ` +
              `${registeredHeaderPromptNames[promptDefinition.name]}. Disable one of these plugins to fix ` +
              `your assistant. If you are developing one of these plugins, change the name of this prompt. ` +
              `A well-designed plugin should only ever have to register at most one of each type of system ` +
              `prompt, and the convention is to give all of your prompts the same name as your plugin ID.`);
          }

          registeredHeaderPromptNames[promptDefinition.name] = pluginMetadata.id;
          addHeaderPrompt(promptDefinition);
        },

        registerFooterSystemPrompt: (promptDefinition: DynamicPrompt) => {
          if (!pluginMetadata.system) {
            const minWeight = 0;
            const maxWeight = 9999;
            if (promptDefinition.weight < minWeight || promptDefinition.weight > maxWeight) {
              throw new Error(`Plugin ${pluginMetadata.id} attempted to register a footer system prompt with ` +
                `invalid weight ${promptDefinition.weight}. Non-system plugins may only register footer system ` +
                `prompts with weights between 0 and 9999. Disable ${pluginMetadata.id} to fix your assistant, ` +
                `or change the weight of this prompt if you are developing this plugin.`);
            }
          }

          if (registeredFooterPromptNames[promptDefinition.name]) {
            throw new Error(`Plugin ${pluginMetadata.id} attempted to register a footer system prompt with ` +
              `name "${promptDefinition.name}", but that name is already registered by plugin ` +
              `${registeredFooterPromptNames[promptDefinition.name]}. Disable one of these plugins to fix ` +
              `your assistant. If you are developing one of these plugins, change the name of this prompt. ` +
              `A well-designed plugin should only ever have to register at most one of each type of system ` +
              `prompt, and the convention is to give all of your prompts the same name as your plugin ID.`);
          }

          registeredFooterPromptNames[promptDefinition.name] = pluginMetadata.id;
          addFooterPrompt(promptDefinition);
        },

        hooks: PluginHooks,

        offer<T extends keyof PluginCapabilities>(capabilities: PluginCapabilities[T]): void {
          if (pluginCapabilities[pluginMetadata.id]) {
            throw new Error(`Plugin ${pluginMetadata.id} has already offered its capabilities. A plugin may only call offer once, and only during its registration callback.`);
          }
          pluginCapabilities[pluginMetadata.id] = capabilities;
        },

        request<T extends keyof PluginCapabilities>(pluginID: T): PluginCapabilities[T] | undefined {
          if (!pluginMetadata.dependencies?.find(dep => dep.id === pluginID)) {
            throw new Error(`Plugin ${pluginMetadata.id} attempted to request the capabilities of plugin ${pluginID}, but it is not declared as a dependency. A plugin may only request the capabilities of plugins on which it declares a dependency.`);
          }

          if (!pluginCapabilities[pluginID]) {
            return undefined;
          }

          return pluginCapabilities[pluginID];
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
    let resolve: () => void, reject: (error: unknown) => void;

    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    loadingPromises[plugin.pluginMetadata.id] = { promise, resolve, reject };
  },

  init: async () => {
    loadedPlugins.forEach((plugin, index) => {
      // check for duplicate plugin ids
      const duplicate = loadedPlugins.find((p, i) => p.pluginMetadata.id === plugin.pluginMetadata.id && i !== index);
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
    await Promise.all(loadedPlugins.map(async plugin => {
      console.log(`Registering plugin: ${plugin.pluginMetadata.id}...`);
      try {
        await plugin.registerPlugin(createPluginInterface(plugin.pluginMetadata));
      } catch (error) {
        console.error(`Error registering plugin ${plugin.pluginMetadata.id}:`, error);
        loadingPromises[plugin.pluginMetadata.id].reject(error);

        throw new Error(`Failed to register plugin ${plugin.pluginMetadata.id}. See previous logs for details.`);
      }
      
      loadingPromises[plugin.pluginMetadata.id].resolve();
      registeredPlugins[plugin.pluginMetadata.id] = plugin;
      console.log(`Plugin registered: ${plugin.pluginMetadata.id}`);
    }));
    // 7. Once all plugins are loaded, call any `onAllPluginsLoaded` hooks, and this
    //    function can return.
  },

  // Future plans:
  // hotLoadPlugin: async (plugin: AlicePlugin) => {},
  // unloadPlugin: async (pluginId: string) => {},
}
