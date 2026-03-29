import { promisify } from 'node:util'
import process from 'node:process';

// Add any exports from node:process that you need to use as promises here.
export const nextTick = promisify(process.nextTick);
