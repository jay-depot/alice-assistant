export type PluginLogger = {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

function hexToRgb(
  hexColor: string
): { r: number; g: number; b: number } | null {
  const normalized = hexColor.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function colorizePrefix(prefix: string, hexColor?: string): string {
  if (!hexColor || !process.stdout.isTTY) {
    return prefix;
  }

  const rgb = hexToRgb(hexColor);
  if (!rgb) {
    return prefix;
  }

  return `\u001b[38;2;${rgb.r};${rgb.g};${rgb.b}m${prefix}\u001b[0m`;
}

export function createPluginLogger(
  pluginId: string,
  brandColor?: string
): PluginLogger {
  const prefix = colorizePrefix(`[${pluginId}]`, brandColor);

  return {
    log: (...args: unknown[]) => {
      args
        .join(' ')
        .split('\n')
        .forEach(line => {
          console.log(prefix, line);
        });
    },
    info: (...args: unknown[]) => {
      args
        .join(' ')
        .split('\n')
        .forEach(line => {
          console.info(prefix, line);
        });
    },
    warn: (...args: unknown[]) => {
      args
        .join(' ')
        .split('\n')
        .forEach(line => {
          console.warn(prefix, line);
        });
    },
    error: (...args: unknown[]) => {
      args
        .join(' ')
        .split('\n')
        .forEach(line => {
          console.error(prefix, line);
        });
    },
    debug: (...args: unknown[]) => {
      args
        .join(' ')
        .split('\n')
        .forEach(line => {
          console.debug(prefix, line);
        });
    },
  };
}
