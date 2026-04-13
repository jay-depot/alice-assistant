const redPrefix = process.stdout.isTTY
  ? '\u001b[38;2;255;59;48m[system]\u001b[0m'
  : '[system]';

export const systemLogger = {
  log: (...args: unknown[]): void => {
    args
      .join(' ')
      .split('\n')
      .forEach(line => {
        console.log(redPrefix, line);
      });
  },
  info: (...args: unknown[]): void => {
    args
      .join(' ')
      .split('\n')
      .forEach(line => {
        console.info(redPrefix, line);
      });
  },
  warn: (...args: unknown[]): void => {
    args
      .join(' ')
      .split('\n')
      .forEach(line => {
        console.warn(redPrefix, line);
      });
  },
  error: (...args: unknown[]): void => {
    args
      .join(' ')
      .split('\n')
      .forEach(line => {
        console.error(redPrefix, line);
      });
  },
  debug: (...args: unknown[]): void => {
    args
      .join(' ')
      .split('\n')
      .forEach(line => {
        console.debug(redPrefix, line);
      });
  },
};
