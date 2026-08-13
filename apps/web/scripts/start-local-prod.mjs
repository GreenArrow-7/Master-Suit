#!/usr/bin/env node
/**
 * Serves the production build locally, without pretending to be production.
 *
 * `next start` sets NODE_ENV=production when nothing else has, and
 * lib/startup-check.ts then refuses to boot because the provider keys are
 * `mock` — correctly, since a mock provider accepts what the real one would
 * reject. That guard is the point and must not be weakened.
 *
 * The escape it names is running the build with NODE_ENV=development, which is
 * exactly what this does: the compiled artefact is served as-is, so the timings
 * are the production ones, but nothing claims to be a deployment. Setting the
 * variable inline is not portable — cmd.exe does not take `VAR=value cmd` — so
 * it happens here instead, once, where it can carry an explanation.
 *
 * The port is the dev server's, deliberately. Both read `.next`, so a build
 * overwrites what `next dev` is serving and the two cannot run at once anyway —
 * giving them separate ports only invited the mistake of leaving the slow one up.
 *
 *   npm run start:local            # port 3000
 *   npm run start:local -- -p 4000
 */
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
if (!args.includes('-p') && !args.includes('--port')) args.push('-p', '3000');

console.log(`Serving the production build with NODE_ENV=development on port ${args[args.indexOf('-p') + 1]}.`);
console.log('Real deployments must set real provider credentials; see lib/startup-check.ts.\n');

const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', ...args], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' },
});
child.on('exit', (code) => process.exit(code ?? 0));
