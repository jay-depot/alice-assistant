/**
 * @file google-location.ts
 *
 * Google Location plugin for A.L.I.C.E. Assistant.
 *
 * A lightweight location provider that depends on both `google-apis` and
 * `location-broker`. It uses an authenticated Google account's People API
 * profile data to provide location information.
 *
 * NOTE: Only one location provider can be enabled at a time. This plugin
 * conflicts with `static-location` — if both are enabled, the assistant
 * will refuse to start with an error from `location-broker`.
 */

import Type from 'typebox';
import { AlicePlugin } from '../../../lib.js';
import type { LocationData } from '../../system/location-broker/location-broker.js';
import type { GoogleApisCapability } from '../google-apis/google-apis.js';

const GoogleLocationPluginConfigSchema = Type.Object({
  /** Preferred Google account ID to use for location data. If empty, uses the first available. */
  preferredAccount: Type.Optional(
    Type.String({
      description:
        'The Google account ID to use for location data. If empty, the first available authenticated account is used.',
    })
  ),
});

type GoogleLocationPluginConfig = Type.Static<
  typeof GoogleLocationPluginConfigSchema
>;

const googleLocationPlugin: AlicePlugin = {
  pluginMetadata: {
    id: 'google-location',
    name: 'Google Location Plugin',
    brandColor: '#34a853', // Google Green
    description:
      'A location provider plugin that uses an authenticated Google account ' +
      'to provide location data to location-broker. Conflicts with static-location — ' +
      'only one location provider can be enabled at a time.',
    version: 'LATEST',
    dependencies: [
      { id: 'google-apis', version: 'LATEST' },
      { id: 'location-broker', version: 'LATEST' },
    ],
    required: false,
  },

  async registerPlugin(pluginInterface) {
    const plugin = await pluginInterface.registerPlugin();
    const config = await plugin.config<GoogleLocationPluginConfig>(
      GoogleLocationPluginConfigSchema,
      {}
    );

    // Cast to our local type since the google-apis capability augmentation
    // is in a different module and may not be visible here at compile time.
    const googleApis = plugin.request('google-apis') as
      | GoogleApisCapability
      | undefined;
    const locationBroker = plugin.request('location-broker');

    if (!googleApis) {
      plugin.logger.error(
        'registerPlugin: google-apis capability not available. ' +
          'Ensure the google-apis plugin is enabled and loaded before google-location.'
      );
      return;
    }

    if (!locationBroker) {
      plugin.logger.error(
        'registerPlugin: location-broker capability not available. ' +
          'Ensure the location-broker plugin is enabled and loaded before google-location.'
      );
      return;
    }

    const { registerLocationProvider } = locationBroker;

    plugin.logger.log('Registering as a location provider.');
    registerLocationProvider('google-location', async () => {
      return getLocationData(
        googleApis,
        config.getPluginConfig(),
        plugin.logger
      );
    });
  },
};

/**
 * Retrieve location data from the Google People API.
 * Uses the preferred account if configured, otherwise the first available.
 */
async function getLocationData(
  googleApis: GoogleApisCapability,
  pluginConfig: GoogleLocationPluginConfig,
  logger: {
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  }
): Promise<LocationData> {
  try {
    // Determine which account to use
    const accountIds = googleApis.listAccounts();

    if (accountIds.length === 0) {
      logger.warn(
        'getLocationData: No Google accounts are connected. Returning empty location data.'
      );
      return {};
    }

    // Use the preferred account if set, otherwise the first available
    const preferredAccountId = pluginConfig.preferredAccount;
    let accountId = preferredAccountId || accountIds[0];

    // Validate that the preferred account exists and is authenticated
    if (preferredAccountId) {
      const accountInfo = googleApis.getAccountInfo(preferredAccountId);
      if (!accountInfo) {
        logger.warn(
          `getLocationData: Preferred account "${preferredAccountId}" not found. Falling back to first available.`
        );
        accountId = accountIds[0];
      } else if (!accountInfo.isAuthenticated) {
        logger.warn(
          `getLocationData: Preferred account "${preferredAccountId}" is not authenticated. Falling back to first available.`
        );
        accountId = accountIds[0];
      }
    }

    // Ensure we use an authenticated account
    const accountInfo = googleApis.getAccountInfo(accountId);
    if (!accountInfo?.isAuthenticated) {
      logger.warn(
        `getLocationData: Account "${accountId}" is not authenticated. Returning empty location data.`
      );
      return {};
    }

    // Get the People API client
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const peopleClient = (await googleApis.getPeopleClient(accountId)) as any;
    if (!peopleClient) {
      logger.warn(
        `getLocationData: Could not get People client for account "${accountId}". Returning empty location data.`
      );
      return {};
    }

    // Fetch the user's profile, which may include locale and addresses
    const profile = await peopleClient.people.get({
      resourceName: 'people/me',
      personFields: 'locales,addresses,emailAddresses',
    });

    const result: LocationData = {};

    // Extract locality/region/country from addresses (residence)
    if (profile.data.addresses && profile.data.addresses.length > 0) {
      // Use the first residence-type address if available
      const residence =
        profile.data.addresses.find(
          (addr: { type?: string }) => addr.type === 'residence'
        ) ?? profile.data.addresses[0];

      if (residence.city) {
        result.localityName = residence.city;
      }
      if (residence.region) {
        result.regionName = residence.region;
      }
      if (residence.country) {
        result.countryName = residence.country;
      }
    }

    // If we didn't get address data but have locale info, try to infer
    if (!result.localityName && !result.regionName && !result.countryName) {
      if (profile.data.locales && profile.data.locales.length > 0) {
        // Locale is like "en-US" - we can at least use the country code
        const localeValue = profile.data.locales[0].value;
        if (localeValue) {
          const parts = localeValue.split('-');
          if (parts.length > 1) {
            // Country code like "US" - not a full country name, but better than nothing
            result.countryName = parts[1];
          }
        }
      }
    }

    return result;
  } catch (err) {
    logger.error(
      `getLocationData: Failed to get location data: ${err instanceof Error ? err.message : String(err)}`
    );
    return {};
  }
}

export default googleLocationPlugin;
