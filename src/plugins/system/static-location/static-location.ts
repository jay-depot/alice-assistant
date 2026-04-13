import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';

const StaticLocationPluginConfigSchema = Type.Object({
  localityName: Type.Optional(
    Type.String({
      description:
        'The name of the locality (e.g. city or town) of the static location',
    })
  ),
  regionName: Type.Optional(
    Type.String({
      description:
        'The name of the region (e.g. state or province) of the static location',
    })
  ),
  countryName: Type.Optional(
    Type.String({
      description: 'The name of the country of the static location',
    })
  ),
  coordinates: Type.Object({
    latitude: Type.Number({
      description: 'The latitude of the static location',
    }),
    longitude: Type.Number({
      description: 'The longitude of the static location',
    }),
  }),
});

const StaticLocationPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'static-location',
    name: 'Static Location Plugin',
    brandColor: '#389595',
    description:
      'A location provider plugin for location-broker that provides a static ' +
      "location to the assistant from the user's configuration settings. This is useful for " +
      "testing, and desktop PCs that don't really move",
    version: 'LATEST',
    dependencies: [{ id: 'location-broker', version: 'LATEST' }],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const { registerLocationProvider } = plugin.request('location-broker');

    const config = (
      await plugin.config(StaticLocationPluginConfigSchema, {
        coordinates: {
          latitude: 0,
          longitude: 0,
        },
      })
    ).getPluginConfig();

    registerLocationProvider('static-location', async () => config);
  },
};

export default StaticLocationPlugin;
