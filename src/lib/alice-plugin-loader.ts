import path from 'node:path';
import { AlicePlugin } from '../lib.js';
import { exists, readFile, readdir } from './node/fs-promised.js';
import { UserConfig } from './user-config.js';
import { AlicePluginEngine } from './alice-plugin-engine.js';
import { satisfies } from 'semver';

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
    "memory": true,
    "scratch-files": true,
    "location-broker": true,
    "notifications-console": true,
    "skills": false,
    "proficiencies": false,
    "mood": true,
    "web-ui": true,
    "reminders-broker": true,
    "application": false,
    "news-broker": true,
    "user-files": false,
    "weather-broker": true,
    "web-search-broker": true,
    "appointments": false,
    "daily-goals": true,
    "moltbook": false
  },
  "user": {
    "enableUserPlugins": false,
    "plugins": {}
  }
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
  const systemPluginsPath = path.join(import.meta.dirname, '..', 'plugins');
  const userPluginsPath = path.join(aliceDir, 'user-plugins');

  const packageJson = JSON.parse(await readFile(path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf-8'));
  const aliceVersion = packageJson.version;

  const systemPlugins: { id: string, name: string, required: boolean }[] = JSON.parse(await readFile(path.join(systemPluginsPath, 'system-plugins.json'), 'utf-8'));

  const enabledSystemPlugins = systemPlugins.map(plugin => {
    if (plugin.required && !userEnabledPlugins.system[plugin.id]) {
      throw new Error(`System plugin ${plugin.name} (${plugin.id}) is required but not enabled. Please enable it in your enabled-plugins.json to continue.`);
    }
    if (userEnabledPlugins.system[plugin.id]) {
      return plugin;
    }
    return null;
  }).filter(plugin => plugin !== null) as { id: string, name: string, required: boolean }[];

  const enabledUserPlugins = userEnabledPlugins.user.enableUserPlugins ? Object.keys(userEnabledPlugins.user.plugins).filter(pluginId => userEnabledPlugins.user.plugins[pluginId]) : [];
  const allEnabledPluginIds = [...enabledSystemPlugins.map(p => p.id), ...enabledUserPlugins];

  // Check for unknown plugins in the enabled list.
  const unknownSystemPlugins = Object.keys(userEnabledPlugins.system).filter(pluginId => !systemPlugins.find(p => p.id === pluginId));

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
    throw new Error(`Unknown user plugins found in enabled-plugins.json: ${unknownUserPlugins.join(', ')}. To fix your assistant immediately, please remove these entries from your enabled-plugins.json. If you think these plugins should be enabled, check your spelling first, then verify  the plugins is a real system plugin listed in system-plugins.json or a real user plugin with a [plugin-id] directory containing [plugin-id].js in your user-plugins directory.`);
  }

  // Finally, we have to check dependency versions, and see if there are any dependency cycles, which 
  // means we're actually loading the `[plugin-id]/[plugin-id].js for each plugin, and then examine the 
  // exported metadata before we can actually insert them into the engine.
  const enabledPlugins = await Promise.all(allEnabledPluginIds.map(async pluginId => {
    const systemPlugin = !!enabledSystemPlugins.find(p => p.id === pluginId);
    const pluginPath = systemPlugin ?
      path.join(systemPluginsPath, pluginId, `${pluginId}.js`) : 
      path.join(userPluginsPath, pluginId, `${pluginId}.js`);
    const pluginModule = (await import(pluginPath)).default as AlicePlugin;
    return pluginModule;
  }));

  enabledPlugins.forEach(plugin => {
    // Check for user plugins claiming to be system plugins or required plugins. This keeps out 
    // one specific kind of low-effort malware.
    const isUsingPrivilegedFlags = plugin.pluginMetadata.system || plugin.pluginMetadata.required;
    if (isUsingPrivilegedFlags && !systemPlugins.find(p => p.id === plugin.pluginMetadata.id)) {
      throw new Error(`Plugin ${plugin.pluginMetadata.id} is claiming to be a system or required ` +
        `plugin and is not one. Assistant startup has been halted in case this is an attempt to ` +
        `do something nasty. To fix your assistant immediately, disable this plugin by ` +
        `removing it from your enabled-plugins.json. If you are developing this plugin, You need to ` +
        `remove the "system" and "required" flags from your plugin metadata and never add them again.`);
    }
    plugin.pluginMetadata.dependencies?.forEach(dependency => {
      const found = enabledPlugins.find(p => p.pluginMetadata.id === dependency.id);
      if (!found) {
        throw new Error(`Plugin ${plugin.pluginMetadata.id} is missing dependency: ${dependency.id}. Please add and enable ${dependency.id}, or disable ${plugin.pluginMetadata.id} to continue.`);
      }

      // Handle system plugins, which all have the special version string "LATEST" which is 
      // supposed to match whatever our npm package version is. They're also the only 
      // plugins allowed to use this special version string.
      if (plugin.pluginMetadata.system) {
        if (found.pluginMetadata.version === 'LATEST') {
          found.pluginMetadata.version = aliceVersion;
        }
        if (dependency.version === 'LATEST') {
          dependency.version = aliceVersion;
        }
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
