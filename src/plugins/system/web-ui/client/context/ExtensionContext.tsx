import { createContext, useContext, type PropsWithChildren } from 'react';
import { createEmptyExtensionRegistry, useExtensions, type ExtensionRegistry } from '../hooks/useExtensions.js';
import type { ExtensionRegistration, PluginClientRoute, UIRegion } from '../types/index.js';

interface ExtensionContextValue {
  registry: ExtensionRegistry;
  routes: PluginClientRoute[];
  registrations: ExtensionRegistration[];
}

const defaultValue: ExtensionContextValue = {
  registry: createEmptyExtensionRegistry(),
  routes: [],
  registrations: [],
};

const ExtensionContext = createContext<ExtensionContextValue>(defaultValue);

export function ExtensionProvider({ children }: PropsWithChildren) {
  const value = useExtensions();

  return (
    <ExtensionContext.Provider value={value}>
      {children}
    </ExtensionContext.Provider>
  );
}

export function useExtensionContext(): ExtensionContextValue {
  return useContext(ExtensionContext);
}

export function useExtensionRegistry(region?: UIRegion) {
  const { registry } = useExtensionContext();
  return region ? registry[region] ?? [] : registry;
}
