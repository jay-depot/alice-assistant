import { AliceCore } from './lib/alice-core.js';
import { systemLogger } from './lib/system-logger.js';

AliceCore.start()
  .catch(err => {
    systemLogger.error('Fatal error', err);
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
