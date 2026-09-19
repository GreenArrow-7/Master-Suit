/**
 * Turns account-deletion execution on for THIS Playwright process only.
 *
 * `@/lib/env` parses `process.env` once, at import, and other specs in the same
 * worker may already have imported it through `./helpers` → `@/lib/db`. So both
 * copies are set: the raw variable, for anything parsed later, and the parsed
 * object this worker already holds. Import order no longer matters.
 *
 * The dev server the browser talks to keeps its own value, so the page copy
 * still describes the server's switch, not this one.
 */
import { env } from '@/lib/env';

process.env.ACCOUNT_DELETION_EXECUTION_ENABLED = 'true';
env.ACCOUNT_DELETION_EXECUTION_ENABLED = true;
