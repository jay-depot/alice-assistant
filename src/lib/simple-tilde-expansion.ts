// This function performs a simple tilde expansion for file paths. It replaces
// a leading '~' with the user's home directory. Other conventions, such as
// '~username' or tildes in the middle of the path, are not supported by this

import path from 'node:path';

// function, and will be returned unchanged.
export function simpleExpandTilde(filePath: string): string {
  if (filePath.startsWith('~/')) {
    const pathParts = filePath.slice(2); // Remove the '~/'
    return path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      pathParts
    );
  }

  return filePath;
}
