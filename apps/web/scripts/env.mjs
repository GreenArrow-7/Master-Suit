/**
 * Loads apps/web/.env into process.env when it exists — what `import 'dotenv/config'`
 * did, with Node's own loader: it handles quotes and CRLF line endings, and never
 * overrides a variable the environment already sets. Import it first, so it runs
 * before any module that reads the environment while it loads.
 */
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile();
