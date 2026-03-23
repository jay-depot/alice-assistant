// Database "connection pool" (It's sqlite) used by the assistant's past interactions memory, and sessions for the web-chat UI.
import { MikroORM } from "@mikro-orm/sqlite";
import * as path from 'path';
import { UserConfig } from './user-config.js';
import { ChatSession, Keyword, Memory } from './db-schemas/index.js';

let orm: MikroORM;

export async function getORM() {
  if (!orm) {
    orm = await MikroORM.init({
      dbName: path.join(UserConfig.getConfigPath(), 'alice.db'),
      entities: [ChatSession, Keyword, Memory],
      debug: false,
      ensureDatabase: true,      
    }) as unknown as MikroORM;

    await orm.schema.update();
  }
  return orm;
}
