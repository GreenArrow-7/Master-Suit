/**
 * The connection every read-only release audit uses.
 *
 *   - One READ ONLY, REPEATABLE READ transaction: a write is an error, and every
 *     section reads the same snapshot. Rolled back at the end.
 *   - The role is checked before anything is counted. Business tables have
 *     FORCE ROW LEVEL SECURITY with policies for the application role, so any
 *     role that is neither superuser nor BYPASSRLS (the table owner included)
 *     would read a filtered, usually empty, table and report it as clean. Such a
 *     role stops here with exit 3.
 *   - `row_security = off` is the second guard: for a role that policies apply
 *     to, Postgres then raises an error instead of filtering, so a restricted
 *     count cannot be printed even if the check above were wrong.
 *
 * Prints the database and role names, never the URL.
 */
import pg from 'pg';

export async function openAudit(title) {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Set MIGRATION_DATABASE_URL (or DATABASE_URL) to the database to inspect.');
    process.exit(2);
  }
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await c.query('SET LOCAL row_security = off');
  const who = (
    await c.query(
      `SELECT current_database() AS db, current_user AS role, r.rolsuper AS super, r.rolbypassrls AS bypass, now() AS at
       FROM pg_roles r WHERE r.rolname = current_user`,
    )
  ).rows[0];
  console.log(
    `${title}: database "${who.db}" as "${who.role}" (superuser: ${who.super ? 'yes' : 'no'}, bypasses row security: ${who.bypass ? 'yes' : 'no'}). Read-only transaction.`,
  );
  if (!who.super && !who.bypass) {
    console.error(
      `STOP: "${who.role}" is subject to row-level security and cannot see every workspace. ` +
        'Counts from this role would be incomplete, so none are printed. Run as the owning role that bypasses row security.',
    );
    await c.end();
    process.exit(3);
  }
  const rows = async (sql, params = []) => (await c.query(sql, params)).rows;
  const done = async () => {
    await c.query('ROLLBACK');
    await c.end();
  };
  return { rows, who, done };
}
