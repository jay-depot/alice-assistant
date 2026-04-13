import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { fetchExtensions } from '../api/extensions.js';
import type {
  AliceUIExtensionApi,
  ExtensionRegistration,
  PluginClientExport,
  PluginClientRoute,
  UIRegion,
} from '../types/index.js';

export type ExtensionRegistry = Record<UIRegion, ComponentType[]>;

export function createEmptyExtensionRegistry(): ExtensionRegistry {
  return {
    'sidebar-top': [],
    'sidebar-bottom': [],
    'chat-header': [],
    'message-prefix': [],
    'message-suffix': [],
    'input-prefix': [],
    'settings-panel': [],
  };
}

export function useExtensions() {
  const [registry, setRegistry] = useState<ExtensionRegistry>(
    createEmptyExtensionRegistry()
  );
  const [routes, setRoutes] = useState<PluginClientRoute[]>([]);
  const [registrations, setRegistrations] = useState<ExtensionRegistration[]>(
    []
  );

  useEffect(() => {
    let isMounted = true;

    const loadExtensions = async () => {
      let extensionList: ExtensionRegistration[] = [];

      try {
        extensionList = await fetchExtensions();
      } catch (error) {
        console.error('Failed to fetch UI extension registrations:', error);
      }

      const nextRegistry = createEmptyExtensionRegistry();
      const nextRoutes: PluginClientRoute[] = [];

      const api: AliceUIExtensionApi = {
        registerComponent: (region, component) => {
          nextRegistry[region].push(component);
        },
        registerRoute: route => {
          nextRoutes.push(route);
        },
      };

      const ensureStylesheet = (styleUrl: string) => {
        const existingLink = Array.from(
          document.head.querySelectorAll<HTMLLinkElement>(
            'link[data-alice-plugin-style-url]'
          )
        ).find(link => link.dataset.alicePluginStyleUrl === styleUrl);

        if (existingLink) {
          return;
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = styleUrl;
        link.dataset.alicePluginStyleUrl = styleUrl;
        document.head.appendChild(link);
      };

      for (const extension of extensionList) {
        try {
          for (const styleUrl of extension.styleUrls ?? []) {
            ensureStylesheet(styleUrl);
          }

          if (!extension.scriptUrl) {
            continue;
          }

          const module = await import(/* @vite-ignore */ extension.scriptUrl);
          const exportedExtension = (module.default ??
            module) as PluginClientExport;

          for (const [region, component] of Object.entries(
            exportedExtension.regions ?? {}
          )) {
            if (component) {
              api.registerComponent(region as UIRegion, component);
            }
          }

          for (const route of exportedExtension.routes ?? []) {
            api.registerRoute(route);
          }

          if (typeof exportedExtension.onAliceUIReady === 'function') {
            await exportedExtension.onAliceUIReady(api);
          }
        } catch (error) {
          console.error(
            `Failed to load UI extension from ${extension.scriptUrl}:`,
            error
          );
        }
      }

      if (!isMounted) {
        return;
      }

      setRegistrations(extensionList);
      setRegistry(nextRegistry);
      setRoutes(nextRoutes);
    };

    void loadExtensions();

    return () => {
      isMounted = false;
    };
  }, []);

  return {
    registry,
    routes,
    registrations,
  };
}
