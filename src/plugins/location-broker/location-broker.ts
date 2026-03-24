import { AlicePlugin } from '../../lib/alice-plugin-interface.js';

type LocationData = {
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  localityName?: string;
  regionName?: string;
  countryName?: string;
};

declare module '../../lib/alice-plugin-interface.js' {
  export interface PluginCapabilities {
    'location-broker': {
      // This API is intentionally minimal for now, and will likely expand in the future. 
      // For now, it just allows plugins to offer location data in a standardized format, and to request location data from any plugin that offers it.
      registerLocationProvider: (name: string, callback: () => Promise<LocationData>) => void;
      requestLocationData: () => Promise<LocationData | undefined>; // returns undefined if no plugin offers location data, otherwise returns the most recently offered location data.
    }
  }
}

const locationBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'location-broker',
    name: 'Location Broker Plugin',
    description: 'Provides an API for other plugins to offer location data to the assistant, ' +
      'and for other plugins to request location data from any plugin that offers it. Note: Only ' +
      'one location provider can be enabled at a time. This plugin will halt assistant startup ' +
      'with an error if two different plugins attempt to register as location providers at once.',
    version: 'LATEST',
    dependencies: [],
    required: true,
    system: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin(locationBrokerPlugin.pluginMetadata);

    plugin.offer<'location-broker'>({
      registerLocationProvider: (name, callback) => {
        // Store the callback and call it whenever we want to update the assistant's location data.
        // If a provider is already registered, throw an error to prevent multiple providers from being registered at once.
      },
      requestLocationData: () => {
        // Return the most recently offered location data, or undefined if no location provider is registered.
        return undefined;
      }
    });
  }
};

export default locationBrokerPlugin;
