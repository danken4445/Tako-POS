import * as SQLite from 'expo-sqlite';

let initialized = false;

export const initializeOfflineDb = async (): Promise<void> => {
  if (initialized) {
    return;
  }

  const db = await SQLite.openDatabaseAsync('takopos.db');

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS pending_mutations (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      table_name TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_mutations_tenant_created
    ON pending_mutations (tenant_id, created_at);
  `);

  initialized = true;
};