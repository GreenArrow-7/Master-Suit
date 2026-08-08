/**
 * A marker unique to one end-to-end run, shared by every spec and the teardown.
 *
 * Every workspace slug and account address the suite invents ends with it, which
 * is what lets globalTeardown delete exactly what this run created and nothing
 * else. Deleting by a looser rule — "looks generated", "created recently" —
 * would eventually take something real with it.
 *
 * Playwright imports this file once per worker, so the value is fixed for the
 * run by the environment variable the config sets before the workers start.
 */
export const RUN_TAG = process.env.E2E_RUN_TAG ?? 'e2elocal';
