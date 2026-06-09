import { AliceCore } from './lib/alice-core.js';
import { systemLogger } from './lib/system-logger.js';

try {
  await AliceCore.start();
} catch (err) {
  systemLogger.error('Fatal error', err);
  process.exit(1);
}
process.exit(0);
