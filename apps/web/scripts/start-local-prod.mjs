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
import { existsSync, rmSync } from 'node:fs';

const DIST = '.next-prod';
const STAMP = `${DIST}/BUILD_ID`;
const NEXT = 'node_modules/next/dist/bin/next';

const args = process.argv.slice(2);
const forceBuild = args.includes('--build');
const passthrough = args.filter((arg) => arg !== '--build');
if (!passthrough.includes('-p') && !passthrough.includes('--port')) passthrough.push('-p', '3000');

/**
 * Only the server gets NODE_ENV=development. The build must not.
 *
 * `next build` under a development NODE_ENV mixes the development and
 * production React builds and prerendering dies on the first page it reaches —
 * `Cannot read properties of null (reading 'useContext')` on /_not-found. The
 * escape the startup check names is for running the artefact, not producing it.
 *
 * Both commands read next.config.ts, so both need NEXT_DIST_DIR or the server
 * looks for a build that is not there.
 */
const run = (argv, extraEnv) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [NEXT, ...argv], {
      stdio: 'inherit',
      env: { ...process.env, NEXT_DIST_DIR: DIST, ...extraEnv },
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`next ${argv[0]} exited with ${code}`))));
  });

if (forceBuild || !existsSync(STAMP)) {
  console.log(`Building into ${DIST}. This takes a few minutes; it is skipped next time.\n`);
  await run(['build']).catch((error) => {
    // A failed build still leaves BUILD_ID behind, and the check above would
    // then read it as a finished one and serve the wreckage.
    rmSync(STAMP, { force: true });
    console.error(`\n${error.message}`);
    process.exit(1);
  });
} else {
  console.log(`Serving the existing ${DIST} build. Pass --build after changing source.\n`);
}

console.log(`Serving with NODE_ENV=development on port ${passthrough[passthrough.indexOf('-p') + 1]}.`);
console.log('Real deployments must set real provider credentials; see lib/startup-check.ts.\n');

await run(['start', ...passthrough], { NODE_ENV: 'development' }).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
