/**
 * Migration runner for Cloudflare D1 database.
 * Tracks applied migrations in the _migrations table and executes new migrations.
 */

export const MIGRATION_001_INIT_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  provider_subject TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  username_normalized TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar_media_id TEXT
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dm_policy TEXT NOT NULL DEFAULT 'everyone',
  feed_preferences TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_provider_subject ON users(provider_subject);
CREATE INDEX IF NOT EXISTS idx_profiles_username_normalized ON profiles(username_normalized);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
`;

export interface MigrationRecord {
  name: string;
  sql: string;
}

export const MIGRATIONS: MigrationRecord[] = [
  {
    name: '001_init.sql',
    sql: MIGRATION_001_INIT_SQL,
  },
];

export async function runMigrations(db: D1Database): Promise<{ applied: string[] }> {
  // Ensure migration tracking table exists
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedQuery = await db.prepare('SELECT name FROM _migrations').all<{ name: string }>();
  const appliedSet = new Set((appliedQuery.results || []).map((r) => r.name));

  const newlyApplied: string[] = [];

  for (const migration of MIGRATIONS) {
    if (!appliedSet.has(migration.name)) {
      // Execute the migration SQL
      await db.exec(migration.sql);

      // Record migration as applied
      const now = new Date().toISOString();
      await db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').bind(migration.name, now).run();

      newlyApplied.push(migration.name);
    }
  }

  return { applied: newlyApplied };
}
