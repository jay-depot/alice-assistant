import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import { BraveSearch } from 'brave-search';

const WebSearchBrokerPluginConfigSchema = Type.Object({
  apiKey: Type.Optional(
    Type.String({ description: 'API key for the Brave Search API' })
  ),
});

type WebSearchBrokerPluginConfigSchema = Type.Static<
  typeof WebSearchBrokerPluginConfigSchema
>;

declare module '../../../lib.js' {
  export interface PluginCapabilities {
    'brave-search-api': {
      getBraveSearchApiClient: () => BraveSearch | null;
    };
  }
}

const braveSearchApiPlugin: AlicePlugin = {
  pluginMetadata: {
    description:
      'Provides a common instance of the Brave search API client for other plugins to use.',
    id: 'brave-search-api',
    name: 'Brave Search API Plugin',
    brandColor: '#7e15d6',
    required: false,
    version: 'LATEST',
    dependencies: [{ id: 'credential-store', version: 'LATEST' }],
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config<WebSearchBrokerPluginConfigSchema>(
      WebSearchBrokerPluginConfigSchema,
      {}
    );

    const credentialStore = plugin.request('credential-store');
    let resolvedApiKey: string | undefined = config.getPluginConfig().apiKey;

    // Check the credential vault first, then fall back to config
    if (!resolvedApiKey) {
      try {
        const vaultKey = await credentialStore.retrieveSecret(
          'brave-search-api.apiKey'
        );
        if (vaultKey) {
          resolvedApiKey = vaultKey;
        }
      } catch {
        // Vault may not be accessible; fall through to config
      }
    }

    // If the config has a real key (not empty), migrate it to the vault
    if (
      config.getPluginConfig().apiKey &&
      config.getPluginConfig().apiKey !== resolvedApiKey
    ) {
      try {
        await credentialStore.storeSecret(
          'brave-search-api.apiKey',
          config.getPluginConfig().apiKey!
        );
        plugin.logger.warn(
          'registerPlugin: Migrated API key from plugin config to the credential vault. ' +
            'Please remove the apiKey from plugin-settings/brave-search-api/brave-search-api.json.'
        );
      } catch {
        // Best effort migration
      }
    }

    const finalApiKey = resolvedApiKey;

    plugin.offer<'brave-search-api'>({
      getBraveSearchApiClient: () => {
        if (!finalApiKey) {
          plugin.logger.warn(
            'Brave Search API Plugin: No API key provided, Brave Search API client will not work. Please provide an API key in the plugin configuration to enable Brave Search API functionality.'
          );
          return null;
        }

        return new BraveSearch(finalApiKey);
      },
    });
  },
};

export default braveSearchApiPlugin;
