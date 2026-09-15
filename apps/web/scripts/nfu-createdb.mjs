import pg from 'pg';
const src = process.env.MIGRATION_DATABASE_URL;
if (!src) {
  console.error('MIGRATION_DATABASE_URL missing');
  process.exit(1);
}
const u = new URL(src);
const target = process.argv[2] ?? 'master_suite_nfu';
const admin = new URL(src);
admin.pathname = '/postgres';
admin.search = '';
const c = new pg.Client({ connectionString: admin.toString() });
await c.connect();
const { rows } = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [target]);
if (rows.length) console.log(`database ${target} already exists`);
else {
  await c.query(`CREATE DATABASE "${target}" OWNER "${u.username}"`);
  console.log(`created ${target} owner=${u.username}`);
}
await c.end();
