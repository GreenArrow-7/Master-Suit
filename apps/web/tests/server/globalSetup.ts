import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';

/**
 * Starts the application for the specs in this directory, and stops it again.
 *
 * `tests/server/*` drive a real HTTP server: they sign in over the network,
 * rotate cookies and read the database that server is connected to. They used to
 * sit under `tests/integration` and be collected by the plain unit run, where
 * they passed only because a developer happened to have `npm run dev` open. On a
 * clean checkout — and in CI, where the unit gate runs before anything starts a
 * server — they failed with ECONNREFUSED.
 *
 * Nothing here is test-only behaviour inside the application. The server is the
 * ordinary dev server, started as a developer would start it.
 */

let child: ChildProcess | null = null;

/**
 * The environment the application should start with.
 *
 * Vitest loads `.env.test` and copies it over `process.env`, so a child spawned
 * with `{ ...process.env }` inherits `DATABASE_URL` pointing at the isolated
 * *test* database. These specs deliberately read the database the running server
 * uses (see the note at the top of each one), and they resolve it from `.env` —
 * so the server would have been reading one database while the fixtures wrote to
 * another. That produced a 401 on every sign-in, because the user existed only
 * in the database the server was not looking at.
 *
 * Removing exactly the keys `.env.test` sets lets Next load `.env` itself, which
 * is what a developer running `npm run dev` gets. `E2E_DATABASE_URL` remains the
 * override for a deployment that wants to point elsewhere.
 */
function serverEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const testEnvFile = path.join(process.cwd(), '.env.test');
  if (!existsSync(testEnvFile)) return env;

  for (const line of readFileSync(testEnvFile, 'utf8').split('\n')) {
    const key = /^\s*([A-Z0-9_]+)\s*=/.exec(line)?.[1];
    if (key) delete env[key];
  }
  return env;
}

/** An OS-assigned free port, so a developer's own server on 3000 is untouched. */
async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * Polls until the server answers, rather than sleeping for a guessed interval.
 * A cold Next route compiles on first request, so the budget is generous.
 */
async function waitForReady(baseUrl: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt made';

  while (Date.now() < deadline) {
    if (child?.exitCode != null) {
      throw new Error(`The application exited with code ${child.exitCode} before becoming ready.`);
    }
    try {
      const response = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `The application did not become ready at ${baseUrl} within ${timeoutMs} ms. Last error: ${lastError}`,
  );
}

export default async function setup() {
  // An externally supplied URL wins, so CI can point these at a deployed
  // instance without this file having to know about it.
  if (process.env.E2E_BASE_URL) return;

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  child = spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: { ...serverEnv(), PORT: String(port) },
  });

  // Kept for the failure message; the server is otherwise silent in test output.
  let log = '';
  child.stdout?.on('data', (chunk) => {
    log = (log + chunk).slice(-4000);
  });
  child.stderr?.on('data', (chunk) => {
    log = (log + chunk).slice(-4000);
  });

  try {
    await waitForReady(baseUrl);
  } catch (error) {
    await stop();
    throw new Error(`${(error as Error).message}\n\n--- application output ---\n${log}`);
  }

  process.env.E2E_BASE_URL = baseUrl;

  // Returned rather than registered on process exit: Vitest awaits this even
  // when the suite fails, so the server does not outlive a red run.
  return stop;
}

async function stop() {
  const target = child;
  child = null;
  if (!target || target.exitCode != null) return;

  // `next dev` spawns a worker; killing the tree is the only reliable way to
  // free the port on Windows.
  if (process.platform === 'win32' && target.pid) {
    spawn('taskkill', ['/pid', String(target.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    target.kill('SIGTERM');
  }

  await Promise.race([once(target, 'exit'), new Promise((resolve) => setTimeout(resolve, 15_000))]);
}
