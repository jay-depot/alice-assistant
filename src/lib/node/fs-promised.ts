import { promisify } from 'node:util';
import fs from 'node:fs';

export const readFile = promisify(fs.readFile);
export const writeFile = promisify(fs.writeFile);
export const readdir = promisify(fs.readdir);
export const stat = promisify(fs.stat);
export const mkdir = promisify(fs.mkdir);
export const unlink = promisify(fs.unlink);
export const rmdir = promisify(fs.rmdir);
export const access = promisify(fs.access);
export const copyFile = promisify(fs.copyFile);
export const rename = promisify(fs.rename);
export const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
