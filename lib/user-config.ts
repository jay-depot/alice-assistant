/**
 * @file user-config.ts
 * 
 * Finds, or creates the expected configuration folder for Alice in the user's home directory. 
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const UserConfig = (() => {
  let config: any; // TODO: Change this config to use convict, so we get type checking and validation for free. This will also allow us to easily add new config options in the future, and provide better error messages when the config is invalid.
  return {
    getConfigPath: () => {
      const homeDir = os.homedir();
      const configDir = path.join(homeDir, '.alice-assistant');
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir);
        // Copy the contents of the config-default folder into the new config directory. This will give the user a starting point for configuring their assistant, and also ensure that all necessary files are in place.
        const defaultConfigDir = path.join(__dirname, '..', 'config-default');
        fs.cpSync(defaultConfigDir, configDir, { recursive: true });
        // TODO: Add default config file here:
        //    - alice.json
        //    - personality/intro.md
        //    - personality/quirks.md
        //    - wake-word-models/README.md # We expect the user to rename the assistant, so they're going to need to train their own wake word model. This file will explain how to do that, and link to resources for training wake word models. This file should have links to a few different sources for how to do that.
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
        const key = path.parse(file).name.replace(/[_-]/g, ' '); // TODO: Is there a library that will title case these for me? I bet there is.
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
      const toolConfigFiles = fs
        .readdirSync(toolSettingsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
        .map((entry) => entry.name);

      config.tools = {};
      for (const file of toolConfigFiles) {
        const filePath = path.join(toolSettingsDir, file);
        const fileData = fs.readFileSync(filePath, 'utf-8');
        const key = path.parse(file).name; // tool config files should be named exactly the same as the tool's call signature, so we can easily match them up.
        config.tools[key] = JSON.parse(fileData);
      }

      // We don't want to return the config here, since we want its consumers to use the cached copy.
    },

    getConfig: () => {
      if (!config) {
        throw new Error('Config not loaded. Please call UserConfig.load() before calling getConfig().');
      }
      return config;
    }
  }
})();
