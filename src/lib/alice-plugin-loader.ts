import path from 'node:path';
import { AlicePlugin } from '../lib.js';
import { exists, readFile, readdir } from './node/fs-promised.js';
import { UserConfig } from './user-config.js';
import { AlicePluginEngine } from './alice-plugin-engine.js';
import { satisfies } from 'semver';
import type { BuiltInPluginCategory } from './types/alice-plugin-interface.js';

type BuiltInPluginDefinition = {
  id: string;
  name: string;
  category: BuiltInPluginCategory;
  required: boolean;
};

type EnabledPluginsConfig = {
  system: Record<string, boolean>;
  user: {
    enableUserPlugins: boolean;
    plugins: Record<string, boolean>;
  }
}

const defaultEnabledPlugins: EnabledPluginsConfig = {
  "system": {
    "datetime": true,
    "system-info": true,
    "personality": true,
    "memory": true,
    "scratch-files": true,
    "location-broker": true,
    "notifications-broker": true,
    "notifications-console": true,
    "notifications-libnotify": false,
    "notifications-chat-segue": true,
    "notifications-chat-interruption": false,
    "notifications-chat-initiate": false,
    "reminders-broker": true,
    "web-ui": true,
    "web-search-broker": true,
    "weather-broker": true,
    "daily-goals": true,
    "skills": false,
    "proficiencies": false,
    "mood": true,
    "application": false,
    "news-broker": true,
    "user-files": false,
    "appointments": false,
    "moltbook": false,
    "remind-me": false,
    "brave-search-api": false,
    "brave-web-search": false,
    "brave-search-news": false,
    "currents-news": false,
    "static-location": false,
    "credential-clapback": false,
    "user-skills": false,
    "lightpanda-browser": false,
    "web-simple-fetch": false,
  },
  "user": {
    "enableUserPlugins": false,
    "plugins": {}
  }
}

async function resolveBuiltInPluginPath(
  builtInPluginsPath: string,
  plugin: BuiltInPluginDefinition,
): Promise<string> {
  const categorizedPath = path.join(builtInPluginsPath, plugin.category, plugin.id, `${plugin.id}.js`);
  if (await exists(categorizedPath)) {
    return categorizedPath;
  }

  const legacyFlatPath = path.join(builtInPluginsPath, plugin.id, `${plugin.id}.js`);
  if (await exists(legacyFlatPath)) {
    return legacyFlatPath;
  }

  throw new Error(
    `Built-in plugin ${plugin.name} (${plugin.id}) is enabled in system-plugins.json but its module file could not be found in either ${plugin.category}/${plugin.id}/${plugin.id}.js or ${plugin.id}/${plugin.id}.js.`,
  );
}

export async function loadPlugins() {
  // Loads all enabled plugins based on the user-level `enabled-plugins.json`, and uses `system-plugins.json` 
  // to determine which plugins are actually allowed to call themselves system plugins then throws if any are 
  // being naughty.
  // Then, check the list of enabled plugins for any unknown/missing plugins, and throw if any are found.
  // Then load all the metadata, and check for circular dependencies, and dependency version matches.
  // Once all checks pass, insert all plugins in declared order into the plugin engine and `.init()` it.
  const aliceDir = UserConfig.getConfigPath();
  const userPluginConfigPath = path.join(aliceDir, 'plugin-settings', 'enabled-plugins.json');
  const userPluginConfigExists = await exists(userPluginConfigPath);
  const rawEnabledPlugins = userPluginConfigExists ? JSON.parse(await readFile(userPluginConfigPath, 'utf-8')) as Partial<EnabledPluginsConfig> : defaultEnabledPlugins;
  const userEnabledPlugins: EnabledPluginsConfig = {
    system: {
      ...defaultEnabledPlugins.system,
      ...rawEnabledPlugins.system,
    },
    user: {
      enableUserPlugins: rawEnabledPlugins.user?.enableUserPlugins ?? defaultEnabledPlugins.user.enableUserPlugins,
      plugins: rawEnabledPlugins.user?.plugins ?? defaultEnabledPlugins.user.plugins,
    }
  };
  const builtInPluginsPath = path.join(import.meta.dirname, '..', 'plugins');
  const userPluginsPath = path.join(aliceDir, 'user-plugins');

  const packageJson = JSON.parse(await readFile(path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf-8'));
  const aliceVersion = packageJson.version;

  const builtInPlugins: BuiltInPluginDefinition[] = JSON.parse(await readFile(path.join(builtInPluginsPath, 'system-plugins.json'), 'utf-8'));

  const enabledBuiltInPlugins = builtInPlugins.map(plugin => {
    if (plugin.required && !userEnabledPlugins.system[plugin.id]) {
      throw new Error(`Built-in plugin ${plugin.name} (${plugin.id}) is required but not enabled. Please enable it in your enabled-plugins.json to continue.`);
    }
    if (userEnabledPlugins.system[plugin.id]) {
      return plugin;
    }
    return null;
  }).filter(plugin => plugin !== null) as BuiltInPluginDefinition[];

  const enabledUserPlugins = userEnabledPlugins.user.enableUserPlugins ? Object.keys(userEnabledPlugins.user.plugins).filter(pluginId => userEnabledPlugins.user.plugins[pluginId]) : [];
  const allEnabledPluginIds = [...enabledBuiltInPlugins.map(p => p.id), ...enabledUserPlugins];

  // Check for unknown plugins in the enabled list.
  const unknownSystemPlugins = Object.keys(userEnabledPlugins.system).filter(pluginId => !builtInPlugins.find(p => p.id === pluginId));

  if (unknownSystemPlugins.length > 0) {
    throw new Error(`Unknown system plugins found in enabled-plugins.json: ${unknownSystemPlugins.join(', ')}. Please remove these entries to continue.`);
  }

  const existingUserPluginDirs = await readdir(userPluginsPath).catch(() => {
    console.log('No user plugins directory found, skipping user plugin loading.');
    return [];
  });
  const existingUserPlugins = await Promise.all(existingUserPluginDirs.map(async dir => {
    const pluginJsonPath = path.join(userPluginsPath, dir, 'plugin.json');
    if (await exists(pluginJsonPath)) {
      const pluginJson = JSON.parse(await readFile(pluginJsonPath, 'utf-8'));
      return { id: pluginJson.id, name: pluginJson.name };
    }
    return null;
  }));

  const unknownUserPlugins = enabledUserPlugins.filter(pluginId => !existingUserPlugins.find(p => p && p.id === pluginId));

  if (unknownUserPlugins.length > 0) {
    throw new Error(`Unknown user plugins found in enabled-plugins.json: ${unknownUserPlugins.join(', ')}. To fix your assistant immediately, please remove these entries from your enabled-plugins.json. If you think these plugins should be enabled, check your spelling first, then verify the plugin is a real built-in plugin listed in system-plugins.json or a real user plugin with a [plugin-id] directory containing [plugin-id].js in your user-plugins directory.`);
  }

  // Finally, we have to check dependency versions, and see if there are any dependency cycles, which 
  // means we're actually loading the `[plugin-id]/[plugin-id].js for each plugin, and then examine the 
  // exported metadata before we can actually insert them into the engine.
  const enabledPlugins = await Promise.all(allEnabledPluginIds.map(async pluginId => {
    const builtInPlugin = enabledBuiltInPlugins.find(p => p.id === pluginId);
    const pluginPath = builtInPlugin
      ? await resolveBuiltInPluginPath(builtInPluginsPath, builtInPlugin)
      : path.join(userPluginsPath, pluginId, `${pluginId}.js`);
    const pluginModule = (await import(pluginPath)).default as AlicePlugin;

    if (builtInPlugin) {
      pluginModule.pluginMetadata.builtInCategory = builtInPlugin.category;
      pluginModule.pluginMetadata.required = builtInPlugin.required;
    }

    return pluginModule;
  }));

  enabledPlugins.forEach(plugin => {
    // Check for user plugins claiming built-in-only flags. This keeps out 
    // one specific kind of low-effort malware.
    const isBuiltInPlugin = !!builtInPlugins.find(p => p.id === plugin.pluginMetadata.id);
    const isUsingPrivilegedFlags = plugin.pluginMetadata.required || plugin.pluginMetadata.builtInCategory;
    if (isUsingPrivilegedFlags && !builtInPlugins.find(p => p.id === plugin.pluginMetadata.id)) {
      throw new Error(`Plugin ${plugin.pluginMetadata.id} is claiming to be a built-in or required ` +
        `plugin and is not one. Assistant startup has been halted in case this is an attempt to ` +
        `do something nasty. To fix your assistant immediately, disable this plugin by ` +
        `removing it from your enabled-plugins.json. If you are developing this plugin, you need to ` +
        `remove the built-in-only flags from your plugin metadata and never add them again.`);
    }

    if (!isBuiltInPlugin && plugin.pluginMetadata.version === 'LATEST') {
      throw new Error(`Plugin ${plugin.pluginMetadata.id} is using the reserved version string LATEST. Only built-in shipped plugins may do this. Disable ${plugin.pluginMetadata.id} to fix your assistant, or replace LATEST with a real semver version if you are developing this plugin.`);
    }

    plugin.pluginMetadata.dependencies?.forEach(dependency => {
      const found = enabledPlugins.find(p => p.pluginMetadata.id === dependency.id);
      if (!found) {
        throw new Error(`Plugin ${plugin.pluginMetadata.id} is missing dependency: ${dependency.id}. Please add and enable ${dependency.id}, or disable ${plugin.pluginMetadata.id} to continue.`);
      }

      // Handle built-in shipped plugins, which all have the special version string "LATEST"
      // that is supposed to match whatever our npm package version is.
      if (isBuiltInPlugin) {
        if (found.pluginMetadata.version === 'LATEST') {
          found.pluginMetadata.version = aliceVersion;
        }
        if (dependency.version === 'LATEST') {
          dependency.version = aliceVersion;
        }
      } else if (dependency.version === 'LATEST') {
        throw new Error(`Plugin ${plugin.pluginMetadata.id} depends on ${dependency.id} using the reserved version string LATEST. Only built-in shipped plugins may use LATEST dependency ranges. Disable ${plugin.pluginMetadata.id} to fix your assistant, or replace LATEST with a real semver range if you are developing this plugin.`);
      }

      if (!satisfies(found.pluginMetadata.version, dependency.version)) {
        throw new Error(`Plugin ${plugin.pluginMetadata.id} has an incompatible version of ` +
          `dependency ${dependency.id}. Required version: ${dependency.version}, found version: ` +
          `${found.pluginMetadata.version}. To fix your assistant, update the version of ` +
          `${dependency.id} you have, or disable ${plugin.pluginMetadata.id} to continue. ` +
          `If you are developing one of these plugins, then update your dependency version ` +
          `to the one you currently have installed`);
      }
    });

    // Cycle check:
    const visited = new Set<string>();
    function visit(pluginId: string) {
      if (visited.has(pluginId)) {
        throw new Error(`Dependency cycle detected involving plugin ${pluginId}. To fix your assistant immediately, disable one of these plugins: ${[...visited].join(', ')}. If you are currently developing any of these plugins, please check your dependencies for cycles and remove them to continue.`);
      }
      visited.add(pluginId);
      const plugin = enabledPlugins.find(p => p.pluginMetadata.id === pluginId);
      plugin.pluginMetadata.dependencies?.forEach(dep => visit(dep.id));
      visited.delete(pluginId);
    }
    visit(plugin.pluginMetadata.id);
  });

  // All checks passed, insert every enabled plugin into the engine and call init.
  enabledPlugins.forEach(plugin => AlicePluginEngine.insertPlugin(plugin));
  return AlicePluginEngine.init();
}
