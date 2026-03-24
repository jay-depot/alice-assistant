import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

type WeatherAlert = {
  title: string;
  description: string;
  severity: 'advisory' | 'watch' | 'warning';
  effectiveDate: Date;
  expiryDate: Date;
};

type WeatherData = {
  temperature: number; // in degrees Celsius
  temperatureUnit: string; // e.g. "C" for Celsius, "F" for Fahrenheit, etc.
  condition: string; // e.g. "sunny", "cloudy", "rainy", etc.
  relativeHumidity: number; // percentage
  relativeHumidityUnit: string; // e.g. "%" for percentage
  precipitationChance: number; // percentage
  precipitationChanceUnit: string; // e.g. "%" for percentage
  forecast?: { // optional forecast data for the next few days
    day: string; // e.g. "Monday", "Tuesday", etc.
    temperatureHigh: number;
    temperatureLow: number;
    condition: string;
    relativeHumidity: number; // percentage
    relativeHumidityUnit: string; // e.g. "%" for percentage
    precipitationChance: number; // percentage
    precipitationChanceUnit: string; // e.g. "%" for percentage
  }[];
  alerts: WeatherAlert[];
};

declare module '../../lib/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    'weather-broker': {
      // This API is intentionally minimal for now, and will likely expand in the future. 
      // For now, it just allows plugins to offer weather data in a standardized format, and to request weather data from any plugin that has it.
      registerWeatherProvider: (name: string, callback: (location: string) => Promise<WeatherData>) => void;
      requestWeatherData: () => Promise<WeatherData | undefined>; // returns undefined if no plugin offers weather data, otherwise returns the most recently offered weather data.
    }
  }
}

const weatherBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'weather-broker',
    name: 'Weather Broker Plugin',
    description: 'Provides an API for other plugins to offer weather data to the assistant, ' +
      'and for other plugins to request weather data from any plugin that has it.',
      // TODO: Should we allow multiple weather providers to be registered at once?
    version: 'LATEST',
    dependencies: [
      { id: 'location-broker', version: 'LATEST' },
      // We don't request anything from the datetime plugin in this plugin (it doesn't offer 
      // anything), but the assistant is unlikely to make sense of weather info without 
      // that context. This is another valid use of dependencies in other plugins.
      { id: 'datetime', version: 'LATEST' }, 
    ],
    required: false,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(weatherBrokerPlugin.pluginMetadata);
    plugin.offer<'weather-broker'>({
      registerWeatherProvider: (name, callback) => {
        // Store the callback and call it whenever we want to get weather data from this provider.
      },
      requestWeatherData: () => {
        // Call the most recently registered weather provider's callback and return the result,
        // or return undefined if no provider is registered.
        return undefined;
      },
    });
  }
};

export default weatherBrokerPlugin;
