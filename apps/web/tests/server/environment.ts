/**
 * The server suites' view of the shared isolation gate.
 *
 * The rules live in `tests/helpers/isolation.ts` because the browser suite needs
 * exactly the same ones and two copies would drift. This file exists so a spec
 * can say what it is without repeating the options.
 */
import { assertDisposableEnvironment as assertShared, type Targets } from '../helpers/isolation';

export { describeTarget, UnsafeTestEnvironment } from '../helpers/isolation';

export type TestTargets = Targets;

export function assertDisposableEnvironment(): Targets {
  return assertShared({ suite: 'server integration', appEnvFile: '.env' });
}
