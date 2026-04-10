import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ExtensionProvider } from './context/ExtensionContext.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root mount element for the web UI.');
}

createRoot(rootElement).render(
  <ExtensionProvider>
    <App />
  </ExtensionProvider>
);
