import { AlicePlugin } from '../../../lib.js';

export type LocationData = {
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  localityName?: string;
  regionName?: string;
  countryName?: string;
};

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'location-broker': {
      // This API is intentionally minimal for now, and will likely expand in the future.
      // For now, it just allows plugins to offer location data in a standardized format, and to request location data from any plugin that offers it.
      registerLocationProvider: (
        name: string,
        callback: () => Promise<LocationData>
      ) => void;
      requestLocationData: () => Promise<LocationData>; // returns undefined if no plugin offers location data, otherwise returns the most recently offered location data.
    };
  }
}

const locationBrokerPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'location-broker',
    name: 'Location Broker Plugin',
    brandColor: '#4be5be',
    description:
      'Provides an API for other plugins to offer location data to the assistant, ' +
      'and for other plugins to request location data from any plugin that offers it. Note: Only ' +
      'one location provider can be enabled at a time. This plugin will halt assistant startup ' +
      'with an error if two different plugins attempt to register as location providers at once. ' +
      'Also adds any available location data to a "footer" system prompt.',
    version: 'LATEST',
    dependencies: [],
    required: true,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const locationProviderNames: string[] = [];
    let locationProvider: () => Promise<LocationData>;
    let locationProviderConflict = false;
    let locationProviderRegistrationClosed = false;

    plugin.offer<'location-broker'>({
      registerLocationProvider: (name, callback) => {
        if (locationProviderRegistrationClosed) {
          throw new Error(
            `Cannot register location provider "${name}" after all plugins have been loaded.`
          );
        }
        // Store the callback and call it whenever we want to update the assistant's location data.
        // If a provider is already registered, track every plugin that attempts to register one
        // until the onAllPluginsLoaded hook, and throw an error there, listing all of the conflicting
        // plugins by name, and instructing the user to disable all but one of them.
        locationProviderNames.push(name);
        if (locationProvider) {
          locationProviderConflict = true;
        } else {
          locationProvider = callback;
        }
      },
      requestLocationData: async () => {
        // Return the most recently offered location data, or undefined if no location provider is
        // registered.
        if (locationProvider) {
          const locationData = await locationProvider();
          return locationData;
        }
        return {};
      },
    });

    plugin.hooks.onAllPluginsLoaded(async () => {
      plugin.logger.log(
        'onAllPluginsLoaded: Starting location provider registration finalization.'
      );
      if (locationProviderConflict) {
        throw new Error(
          `Multiple plugins attempted to register as location providers: ${locationProviderNames.join(', ')}. Please disable all but one of these plugins and try starting your assistant again.`
        );
      }
      locationProviderRegistrationClosed = true;
      plugin.logger.log(
        'onAllPluginsLoaded: Completed location provider registration finalization.'
      );
    });

    plugin.registerFooterSystemPrompt({
      name: 'locationFooter',
      weight: 99998,
      getPrompt: async () => {
        const locationData = locationProvider
          ? await locationProvider()
          : undefined;
        if (!locationData) {
          return false;
        }
        const systemPromptChunks: string[] = [];
        systemPromptChunks.push(`# CURRENT LOCATION\n`);
        if (locationData.coordinates) {
          systemPromptChunks.push(
            `Coordinates: ${locationData.coordinates.latitude}, ${locationData.coordinates.longitude}`
          );
        }
        if (locationData.localityName) {
          systemPromptChunks.push(`Locality: ${locationData.localityName}`);
        }
        if (locationData.regionName) {
          systemPromptChunks.push(`Region: ${locationData.regionName}`);
        }
        if (locationData.countryName) {
          systemPromptChunks.push(`Country: ${locationData.countryName}`);
        }

        if (systemPromptChunks.length === 1) {
          // No location data was provided by the location provider, so don't include a location
          // footer prompt at all.
          return false;
        }

        return systemPromptChunks.join('\n');
      },
    });
  },
};

export default locationBrokerPlugin;
