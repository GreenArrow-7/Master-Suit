#!/usr/bin/env node
/**
 * Serves the production build locally, without pretending to be production.
 *
 * The build is `output: 'standalone'` (next.config.ts), so it is served the way
 * infra/Dockerfile serves it: `node server.js`, out of the bundle. `next start`
 * did the job here until Next 16.3.4 began saying — correctly — that the two do
 * not go together; it had been working by accident, one release from stopping.
 *
 * Serving the artefact is not deploying it, and lib/startup-check.ts refuses to
 * boot under NODE_ENV=production while the provider keys are `mock` — correctly,
 * since a mock provider accepts what the real one would reject. That guard is
 * the point and must not be weakened. The escape it names is running the build
 * with NODE_ENV=development, which is what happens below; the standalone server
 * sets production for itself, so the variable is put back rather than passed in.
 * Setting it inline is not portable either — cmd.exe does not take
 * `VAR=value cmd` — so it happens here, once, where it can carry an explanation.
 *
 * The port is the dev server's, deliberately. Both read `.next`, so a build
 * overwrites what `next dev` is serving and the two cannot run at once anyway —
 * giving them separate ports only invited the mistake of leaving the slow one up.
 *
 * The build lands in `.next-prod`, not `.next`, so `next dev` cannot wipe it and
 * it cannot wipe `next dev`. They shared a directory until they didn't, and a
 * rebuild on this tree costs between two and six minutes — long enough that
 * losing one to a dev session is the whole reason the fast build went unused.
 *
 *   npm run start:local            # port 3000; builds only if .next-prod is absent
 *   npm run start:local -- --build # rebuild first, after changing source
 *   npm run start:local -- -p 4000
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const DIST = '.next-prod';
const STAMP = `${DIST}/BUILD_ID`;
const STANDALONE = `${DIST}/standalone`;
const NEXT = 'node_modules/next/dist/bin/next';

const args = process.argv.slice(2);
const forceBuild = args.includes('--build');
const portFlag = args.findIndex((arg) => arg === '-p' || arg === '--port');
const port = portFlag === -1 ? '3000' : args[portFlag + 1];
// The port reaches the standalone server as $PORT, which it parses with a `||
// 3000` fallback — so a missing or malformed one silently serves the port you
// did not ask for. `next start` rejected it; keep rejecting it.
if (!/^\d+$/.test(port ?? '')) {
  console.error(`${args[portFlag]} needs a port number.`);
  process.exit(1);
}

/**
 * Only the server gets NODE_ENV=development. The build must not.
 *
 * `next build` under a development NODE_ENV mixes the development and
 * production React builds and prerendering dies on the first page it reaches —
 * `Cannot read properties of null (reading 'useContext')` on /_not-found. The
 * escape the startup check names is for running the artefact, not producing it.
 *
 * The build reads next.config.ts and so needs NEXT_DIST_DIR to land anywhere but
 * `.next`. The server does not: `next build` inlines the resolved config into
 * the bundle it generates, `.next-prod` and all.
 */
const run = (label, argv, extraEnv) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      stdio: 'inherit',
      env: { ...process.env, NEXT_DIST_DIR: DIST, ...extraEnv },
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited with ${code}`))));
  });

if (forceBuild || !existsSync(STAMP)) {
  console.log(`Building into ${DIST}. This takes a few minutes; it is skipped next time.\n`);
  await run('next build', [NEXT, 'build']).catch((error) => {
    // A failed build still leaves BUILD_ID behind, and the check above would
    // then read it as a finished one and serve the wreckage.
    rmSync(STAMP, { force: true });
    console.error(`\n${error.message}`);
    process.exit(1);
  });
} else {
  console.log(`Serving the existing ${DIST} build. Pass --build after changing source.\n`);
}

// The bundle is deliberately incomplete: `next build` leaves `<dist>/static` and
// `public/` for whoever deploys it to place, which is what the two COPY lines in
// infra/Dockerfile do. Without them the pages render and every script, stylesheet
// and icon they ask for is a 404. Copied on every start rather than only after a
// build, so a tree left by an earlier revision of this script heals itself.
cpSync(`${DIST}/static`, `${STANDALONE}/${DIST}/static`, { recursive: true });
cpSync('public', `${STANDALONE}/public`, { recursive: true });

// The bundle carries a copy of .env, taken when it was built — so without this
// line, editing .env and restarting would go on serving the values the build
// happened to see. Loading the live file here puts it in the environment the
// server inherits, and @next/env never overwrites a variable that is already
// set, so it wins. After the build and not before: .env sets NODE_ENV, which is
// the one thing the build must not be handed (see above).
if (existsSync('.env')) process.loadEnvFile('.env');

console.log(`Serving ${STANDALONE} with NODE_ENV=development on port ${port}.`);
console.log('Real deployments must set real provider credentials; see lib/startup-check.ts.\n');

/**
 * `server.js` sets NODE_ENV=production and chdirs into the bundle before it
 * listens. A deployment wants both; this preview wants neither — production
 * trips the startup check above ("Refusing to start in production with mock
 * providers configured", and the process exits), and the new cwd moves every
 * relative path the application resolves, ATTENDANCE_CAPTURE_DIR among them,
 * inside a directory that the next `--build` deletes.
 *
 * Undoing them on the line after `require` is enough: that still runs before
 * `startServer` reaches its first await, so nothing the application loads — the
 * instrumentation hook and its startup check included — ever sees either value.
 */
const undoDeploymentDefaults = [
  'const cwd = process.cwd();',
  'require(process.argv[1]);',
  "process.env.NODE_ENV = 'development';",
  'process.chdir(cwd);',
].join('');

await run('the server', ['-e', undoDeploymentDefaults, resolvePath(STANDALONE, 'server.js')], {
  PORT: port,
  // Pinned rather than inherited: `next start` ignored $HOSTNAME and always
  // bound 0.0.0.0, while the standalone server binds whatever it finds there —
  // infra/Dockerfile has to pin the same variable for the same reason. An
  // environment that exports one would otherwise move the preview off localhost.
  HOSTNAME: '0.0.0.0',
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
