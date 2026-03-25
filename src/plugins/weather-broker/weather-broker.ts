import { AlicePlugin } from '../../lib/alice-plugin-interface.js';
import { LocationData } from '../location-broker/location-broker.js';

export type WeatherAlert = {
  title: string;
  description: string;
  severity: 'advisory' | 'watch' | 'warning';
  effectiveDate: Date;
  expiryDate: Date;
};

export type WeatherData = {
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
  alerts?: WeatherAlert[];
};

declare module '../../lib/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    'weather-broker': {
      registerWeatherProvider: (name: string, callback: (location: LocationData) => Promise<WeatherData>) => void;
      requestWeatherData: () => Promise<Record<string, WeatherData> | undefined>; // returns undefined if no plugin offers weather data, otherwise returns the most recently offered weather data.
      getPreferredProviderId: () => Promise<string>;
    }
  }
}

const weatherBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'weather-broker',
    name: 'Weather Broker Plugin',
    description: 'Provides an API for other plugins to offer weather data to the assistant, ' +
      'and for other plugins to request weather data from any plugin that offers it.',
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
    const weatherProviderCallbacks: Record<string, (location: LocationData) => Promise<WeatherData>> = {};
    const { requestLocationData } = plugin.request('location-broker');

    plugin.offer<'weather-broker'>({
      registerWeatherProvider: (name, callback) => {
        // Store the callback and call it whenever we want to get weather data from this provider.
        weatherProviderCallbacks[name] = callback;
      },
      requestWeatherData: async () => {
        // Call all registered weather providers' callbacks and return the results in an object 
        // keyed by provider name. or return undefined if no providers are registered.
        if (Object.keys(weatherProviderCallbacks).length === 0) {
          return undefined;
        }

        const results: Record<string, WeatherData> = {};
        await Promise.all(Object.entries(weatherProviderCallbacks).map(async ([name, callback]) => {
          const locationData = await requestLocationData();
          results[name] = await callback(locationData);
        }));
        
        return results;
      },
      async getPreferredProviderId() {
        return ''; //TODO
      },
    });
  }
};

export default weatherBrokerPlugin;
