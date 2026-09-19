/**
 * Turns account-deletion execution on for THIS Playwright process only.
 *
 * `@/lib/env` parses `process.env` once, at import, and `./helpers` imports it
 * transitively through `@/lib/db`. A spec that runs the real maintenance worker
 * in-process therefore has to set the switch before its first application
 * import — which, after compilation to CommonJS, means a side-effect import
 * listed first. The dev server the browser talks to keeps its own value, so the
 * page copy still describes the server's switch, not this one.
 */
process.env.ACCOUNT_DELETION_EXECUTION_ENABLED = 'true';
