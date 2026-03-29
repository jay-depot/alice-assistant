/**
 * @file user-config.ts
 * 
 * Finds, or creates the expected configuration folder for Alice in the user's home directory. 
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
// TODO: Validate loaded files against these schemas.
import { SystemConfigBasic } from './types/system-config-basic.js'; 
import { SystemConfigFull } from './types/system-config-full.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const UserConfig = (() => {
  let config: SystemConfigFull; // TODO: Change this config to use convict, so we get type checking and validation for free. This will also allow us to easily add new config options in the future, and provide better error messages when the config is invalid.
  return {
    getConfigPath: () => {
      const homeDir = os.homedir();
      const configDir = path.join(homeDir, '.alice-assistant');
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir);
        // Copy the contents of the config-default folder into the new config directory. This will give the user a starting point for configuring their assistant, and also ensure that all necessary files are in place.
        const defaultConfigDir = path.join(currentDir, '..', '..', 'config-default');
        fs.cpSync(defaultConfigDir, configDir, { recursive: true });
      }
      return configDir;
    },

    load: () => {
      // load alice.json, and cache it
      const configPath = path.join(UserConfig.getConfigPath(), 'alice.json');
      if (!fs.existsSync(configPath)) {
        // We should crash here. An empty config was *just* created if we got to this point, so something very bad happened.
        throw new Error(`Config file not found at ${configPath}. This should never happen, \
          as the config directory and default config file should have been created if they \
          didn't exist. Please check the permissions of the config directory and try again.`);
      }
      const configData = fs.readFileSync(configPath, 'utf-8');
      config = JSON.parse(configData);
      // load personality files, and cache them
      const personalityDir = path.join(UserConfig.getConfigPath(), 'personality');
      if (!fs.existsSync(personalityDir)) {
        // We should crash here. An empty config was *just* created if we got to this point, so something very bad happened.
        throw new Error(`Personality directory not found at ${personalityDir}. This should never happen, \
          as the config directory and default config file should have been created if they \
          didn't exist. Please check the permissions of the config directory and try again.`);
      }
      const personalityFiles = fs
        .readdirSync(personalityDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md')
        .map((entry) => entry.name);

      config.personality = {};
      for (const file of personalityFiles) {
        const filePath = path.join(personalityDir, file);
        const fileData = fs.readFileSync(filePath, 'utf-8');
        const key = path.parse(file).name.replace(/[_-]/g, ' ').toLocaleUpperCase();
        config.personality[key] = fileData;
      }

      // Load the tool configs.
      const toolSettingsDir = path.join(UserConfig.getConfigPath(), 'tool-settings');
      if (!fs.existsSync(toolSettingsDir)) {
        // We should crash here. An empty config was *just* created if we got to this point, so something very bad happened.
        throw new Error(`Tool settings directory not found at ${toolSettingsDir}. This should never happen, \
          as the config directory and default config file should have been created if they \
          didn't exist. Please check the permissions of the config directory and try again.`);
      }
      // We don't want to return the config here, since we want its consumers to use the cached copy.
    },

    getConfig: (): SystemConfigFull => {
      if (!config) {
        throw new Error('Config not loaded. Please call UserConfig.load() before calling getConfig().');
      }
      return config;
    }
  }
})();
