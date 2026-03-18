import { AliceCore } from './lib/alice-core';

AliceCore.start().catch((err) => {
  console.error('Fatal error', err);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
