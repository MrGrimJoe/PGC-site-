import { describe, it, expect } from 'vitest';
import { createSqliteD1 } from '../worker/db/sqlite-d1.ts';
import { runMigrations } from '../worker/db/migrate.ts';

describe('Migrations runner', () => {
  it('applies migrations from an empty database', async () => {
    // Brand new empty in-memory D1 database
    const db = createSqliteD1(':memory:');

    // Run migrations
    const result = await runMigrations(db);

    expect(result.applied).toContain('001_init.sql');

    // Verify _migrations tracking table contains 001_init.sql
    const migrationsRows = await db.prepare('SELECT name FROM _migrations').all<{ name: string }>();
    expect(migrationsRows.results.map((r) => r.name)).toContain('001_init.sql');

    // Verify all required tables exist
    const tablesQuery = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .all<{ name: string }>();

    const tableNames = tablesQuery.results.map((r) => r.name);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('profiles');
    expect(tableNames).toContain('user_settings');
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('_migrations');

    // Verify indexes exist
    const indexQuery = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
      )
      .all<{ name: string }>();

    const indexNames = indexQuery.results.map((r) => r.name);
    expect(indexNames).toContain('idx_users_provider_subject');
    expect(indexNames).toContain('idx_profiles_username_normalized');
    expect(indexNames).toContain('idx_sessions_user_id');
    expect(indexNames).toContain('idx_sessions_expires_at');
  });

  it('is idempotent when run multiple times', async () => {
    const db = createSqliteD1(':memory:');

    // First run
    const firstRun = await runMigrations(db);
    expect(firstRun.applied.length).toBeGreaterThan(0);

    // Second run: should not re-run 001_init.sql
    const secondRun = await runMigrations(db);
    expect(secondRun.applied.length).toBe(0);
  });
});
