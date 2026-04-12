import { Record, Type } from 'typebox';
import Schema from 'typebox/schema';
import { DynamicPrompt } from './dynamic-prompt.js';
import { Tool } from './tool-system.js';
import {
  AlicePlugin,
  AlicePluginInterface,
  AlicePluginMetadata,
  PluginCapabilities,
} from './types/alice-plugin-interface.js';
import { UserConfig } from './user-config.js';
import { SystemConfigFull } from './types/system-config-full.js';
import { PluginHooks } from './plugin-hooks.js';
import { addHeaderPrompt } from './header-prompts.js';
import { addFooterPrompt } from './footer-prompts.js';
import { addConversationTypeToTool, addTool, hasTool } from './tools.js';
import { exists, mkdir, writeFile } from './node/fs-promised.js';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { PluginHookInvocations } from './plugin-hooks.js';
import {
  getConversationTypeOwner,
  registerConversationType,
} from './conversation-types.js';
import { TaskAssistants } from './task-assistant.js';
import { AgentSystem } from './agent-system.js';

const loadedPlugins: AlicePlugin[] = [];
const registeredPlugins: Record<string, AlicePlugin> = {};
const registeredHeaderPromptNames: Record<string, string> = {};
const registeredFooterPromptNames: Record<string, string> = {};
const registeredToolNames: Record<string, string> = {};
const pendingConversationTypeToolLinks: Array<{
  requestingPluginId: string;
  conversationTypeId: string;
  sourcePluginId: string;
  toolName: string;
}> = [];

const pluginCapabilities = {} as PluginCapabilities;
const loadingPromises: Record<
  string,
  {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
  }
> = {};

const mkdirMemoized = (() => {
  const dirPromisedRecord: Record<string, Promise<string>> = {};

  return async (dir: string) => {
    if (!dirPromisedRecord[dir]) {
      dirPromisedRecord[dir] = mkdir(dir, { recursive: true });
    }

    await dirPromisedRecord[dir];
  };
})();

function validatePluginConfig(
  config: unknown,
  schema: Type.TSchema,
  pluginId: string
): void {
  const validationResult = Schema.Check(schema, config);
  if (!validationResult) {
    throw new Error(`Config file for plugin ${pluginId} is invalid.`);
  }
}

type EnginePluginInterface = AlicePluginInterface & {
  closeRegistration: () => void;
};

function createPluginInterface(
  pluginMetadata: AlicePluginMetadata
): EnginePluginInterface {
  let registrationClosed = false;

  function isBuiltInPlugin(): boolean {
    return !!pluginMetadata.builtInCategory;
  }

  function assertRegistrationOpen(featureName: string): void {
    if (registrationClosed) {
      throw new Error(
        `Plugin ${pluginMetadata.id} attempted to register ${featureName} after its registration callback had already finished. Disable ${pluginMetadata.id} to fix your assistant. If you are developing this plugin, register ${featureName} during the plugin registration callback instead.`
      );
    }
  }

  const api = {
    registerPlugin: async () => {
      const dependencyIds =
        pluginMetadata.dependencies?.map(dep => dep.id) || [];
      const dependencyPromises = dependencyIds.map(
        depId => loadingPromises[depId].promise
      );

      await Promise.all(dependencyPromises);

      return {
        registerTool: (toolDefinition: Tool) => {
          assertRegistrationOpen(`tool ${toolDefinition.name}`);

          if (registeredToolNames[toolDefinition.name]) {
            throw new Error(
              `Plugin ${pluginMetadata.id} attempted to register a tool with name ` +
                `"${toolDefinition.name}", but that name is already registered by plugin ` +
                `${registeredToolNames[toolDefinition.name]}. Disable one of these plugins to fix ` +
                `your assistant. If you are developing one of these plugins, change the name of ` +
                `this tool.`
            );
          }

          registeredToolNames[toolDefinition.name] = pluginMetadata.id;
          addTool(toolDefinition);
        },

        registerHeaderSystemPrompt: (promptDefinition: DynamicPrompt) => {
          assertRegistrationOpen(
            `header system prompt ${promptDefinition.name}`
          );

          if (!isBuiltInPlugin()) {
            const minWeight = 0;
            const maxWeight = 9999;
            if (
              promptDefinition.weight < minWeight ||
              promptDefinition.weight > maxWeight
            ) {
              throw new Error(
                `Plugin ${pluginMetadata.id} attempted to register a header system prompt with ` +
                  `invalid weight ${promptDefinition.weight}. Non-built-in plugins may only register header system ` +
                  `prompts with weights between 0 and 9999. Disable ${pluginMetadata.id} to fix your assistant, ` +
                  `or change the weight of this prompt if you are developing this plugin.`
              );
            }
          }

          if (registeredHeaderPromptNames[promptDefinition.name]) {
            throw new Error(
              `Plugin ${pluginMetadata.id} attempted to register a header system prompt with ` +
                `name "${promptDefinition.name}", but that name is already registered by plugin ` +
                `${registeredHeaderPromptNames[promptDefinition.name]}. Disable one of these plugins to fix ` +
                `your assistant. If you are developing one of these plugins, change the name of this prompt. ` +
                `A well-designed plugin should only ever have to register at most one of each type of system ` +
                `prompt, and the convention is to give all of your prompts the same name as your plugin ID.`
            );
          }

          registeredHeaderPromptNames[promptDefinition.name] =
            pluginMetadata.id;
          addHeaderPrompt(promptDefinition);
        },

        registerFooterSystemPrompt: (promptDefinition: DynamicPrompt) => {
          assertRegistrationOpen(
            `footer system prompt ${promptDefinition.name}`
          );

          if (!isBuiltInPlugin()) {
            const minWeight = 0;
            const maxWeight = 9999;
            if (
              promptDefinition.weight < minWeight ||
              promptDefinition.weight > maxWeight
            ) {
              throw new Error(
                `Plugin ${pluginMetadata.id} attempted to register a footer system prompt with ` +
                  `invalid weight ${promptDefinition.weight}. Non-built-in plugins may only register footer system ` +
                  `prompts with weights between 0 and 9999. Disable ${pluginMetadata.id} to fix your assistant, ` +
                  `or change the weight of this prompt if you are developing this plugin.`
              );
            }
          }

          if (registeredFooterPromptNames[promptDefinition.name]) {
            throw new Error(
              `Plugin ${pluginMetadata.id} attempted to register a footer system prompt with ` +
                `name "${promptDefinition.name}", but that name is already registered by plugin ` +
                `${registeredFooterPromptNames[promptDefinition.name]}. Disable one of these plugins to fix ` +
                `your assistant. If you are developing one of these plugins, change the name of this prompt. ` +
                `A well-designed plugin should only ever have to register at most one of each type of system ` +
                `prompt, and the convention is to give all of your prompts the same name as your plugin ID.`
            );
          }

          registeredFooterPromptNames[promptDefinition.name] =
            pluginMetadata.id;
          addFooterPrompt(promptDefinition);
        },

        registerConversationType: conversationTypeDefinition => {
          assertRegistrationOpen(
            `conversation type ${conversationTypeDefinition.id}`
          );
          registerConversationType(
            conversationTypeDefinition,
            pluginMetadata.id
          );
        },

        registerTaskAssistant: definition => {
          assertRegistrationOpen(`task assistant ${definition.id}`);
          TaskAssistants.registerDefinition(pluginMetadata.id, definition);
        },

        registerSessionLinkedAgent: definition => {
          assertRegistrationOpen(`session-linked agent ${definition.id}`);
          AgentSystem.registerDefinition(pluginMetadata.id, definition);
          const autoStartTool = AgentSystem.generateStartTool(definition);
          return { autoStartTool };
        },

        addToolToConversationType: (
          conversationTypeId,
          sourcePluginId,
          toolName
        ) => {
          assertRegistrationOpen(
            `tool link ${sourcePluginId}.${toolName} -> ${conversationTypeId}`
          );
          pendingConversationTypeToolLinks.push({
            requestingPluginId: pluginMetadata.id,
            conversationTypeId,
            sourcePluginId,
            toolName,
          });
        },

        hooks: PluginHooks(pluginMetadata.id),

        offer<T extends keyof PluginCapabilities>(
          capabilities: PluginCapabilities[T]
        ): void {
          assertRegistrationOpen('plugin capabilities');

          if (pluginCapabilities[pluginMetadata.id]) {
            throw new Error(
              `Plugin ${pluginMetadata.id} has already offered its capabilities. A plugin may only call offer once, and only during its registration callback.`
            );
          }
          pluginCapabilities[pluginMetadata.id] = capabilities;
        },

        request<T extends keyof PluginCapabilities>(
          pluginID: T
        ): PluginCapabilities[T] | undefined {
          if (!pluginMetadata.dependencies?.find(dep => dep.id === pluginID)) {
            throw new Error(
              `Plugin ${pluginMetadata.id} attempted to request the capabilities of plugin ${pluginID}, but it is not declared as a dependency. A plugin may only request the capabilities of plugins on which it declares a dependency.`
            );
          }

          if (!pluginCapabilities[pluginID]) {
            return undefined;
          }

          return pluginCapabilities[pluginID];
        },

        config: async (schema, defaults) => {
          // Get config directory root
          const configDir = UserConfig.getConfigPath();
          // Check for plugin-settings directory, create if doesn't exist
          const pluginSettingsDir = path.join(configDir, 'plugin-settings');

          if (!(await exists(pluginSettingsDir))) {
            await mkdirMemoized(pluginSettingsDir);
          }

          // check for this plugin's config directory, create if doesn't exist
          const pluginConfigDir = path.join(
            pluginSettingsDir,
            pluginMetadata.id
          );
          if (!(await exists(pluginConfigDir))) {
            await mkdirMemoized(pluginConfigDir);
          }

          // check for this plugin's config file, create if doesn't exist with default values from schema
          const pluginConfigPath = path.join(
            pluginConfigDir,
            `${pluginMetadata.id}.json`
          );
          if (!(await exists(pluginConfigPath))) {
            const defaultConfig = defaults;
            validatePluginConfig(defaultConfig, schema, pluginMetadata.id);

            await writeFile(
              pluginConfigPath,
              JSON.stringify(defaultConfig, null, 2),
              'utf-8'
            );
          }

          const configContent = JSON.parse(
            await readFile(pluginConfigPath, 'utf-8')
          );
          validatePluginConfig(configContent, schema, pluginMetadata.id);

          // load this plugin's config file, validate against schema, and return the config object
          return {
            getPluginConfig() {
              // Asserted to be Type.Static<typeof schema>, but if we actually dare to say that, we get a TS2589.
              return configContent;
            },

            getSystemConfig() {
              return {
                ...UserConfig.getConfig(),
                configDirectory: UserConfig.getConfigPath(),
              } as SystemConfigFull;
            },
          };
        },
      };
    },

    closeRegistration: () => {
      registrationClosed = true;
    },
  } as EnginePluginInterface;

  return api;
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
      const duplicate = loadedPlugins.find(
        (p, i) =>
          p.pluginMetadata.id === plugin.pluginMetadata.id && i !== index
      );
      if (duplicate) {
        throw new Error(
          `Duplicate plugin id found: ${plugin.pluginMetadata.id}. Please remove one of the plugins with this id to continue.`
        );
      }

      // check for missing dependencies
      plugin.pluginMetadata.dependencies?.forEach(dependency => {
        // TODO: Version checking.
        const found = loadedPlugins.find(
          p => p.pluginMetadata.id === dependency.id
        );
        if (!found) {
          throw new Error(
            `Plugin ${plugin.pluginMetadata.id} is missing dependency: ${dependency.id}. Please add and enable ${dependency.id}, or disable ${plugin.pluginMetadata.id} to continue.`
          );
        }
      });
    });
    await Promise.all(
      loadedPlugins.map(async plugin => {
        console.log(`Registering plugin: ${plugin.pluginMetadata.id}...`);
        const pluginInterface = createPluginInterface(plugin.pluginMetadata);

        try {
          await plugin.registerPlugin(pluginInterface);
        } catch (error) {
          console.error(
            `Error registering plugin ${plugin.pluginMetadata.id}:`,
            error
          );
          loadingPromises[plugin.pluginMetadata.id].reject(error);

          throw new Error(
            `Failed to register plugin ${plugin.pluginMetadata.id}.`,
            { cause: error }
          );
        }

        pluginInterface.closeRegistration();

        loadingPromises[plugin.pluginMetadata.id].resolve();
        registeredPlugins[plugin.pluginMetadata.id] = plugin;
        console.log(`Plugin registered: ${plugin.pluginMetadata.id}`);
      })
    );

    pendingConversationTypeToolLinks.forEach(toolLink => {
      const conversationTypeOwner = getConversationTypeOwner(
        toolLink.conversationTypeId
      );
      if (conversationTypeOwner !== toolLink.requestingPluginId) {
        throw new Error(
          `Plugin ${toolLink.requestingPluginId} attempted to add tool ${toolLink.sourcePluginId}.${toolLink.toolName} to conversation type ${toolLink.conversationTypeId}, but that conversation type is not owned by ${toolLink.requestingPluginId}. Register the conversation type first in ${toolLink.requestingPluginId}, then retry.`
        );
      }

      const sourcePluginEnabled = !!registeredPlugins[toolLink.sourcePluginId];
      if (!sourcePluginEnabled) {
        return;
      }

      const registeredToolOwner = registeredToolNames[toolLink.toolName];
      if (
        !hasTool(toolLink.toolName) ||
        registeredToolOwner !== toolLink.sourcePluginId
      ) {
        throw new Error(
          `Plugin ${toolLink.requestingPluginId} attempted to add tool ${toolLink.sourcePluginId}.${toolLink.toolName} to conversation type ${toolLink.conversationTypeId}, but plugin ${toolLink.sourcePluginId} is enabled and does not provide that tool. Disable ${toolLink.requestingPluginId} to fix your assistant, or correct the requested plugin/tool name if you are developing this plugin.`
        );
      }

      addConversationTypeToTool(toolLink.toolName, toolLink.conversationTypeId);
    });

    await PluginHookInvocations.invokeOnAllPluginsLoaded();
  },

  getLoadedPlugins: () => {
    return loadedPlugins.map(plugin => plugin.pluginMetadata);
  },

  // Future plans:
  // hotLoadPlugin: async (plugin: AlicePlugin) => {},
  // unloadPlugin: async (pluginId: string) => {},
};
