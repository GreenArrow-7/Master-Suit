/**
 * The Windows bootstrap scripts must be able to finish.
 *
 * ── The failure this exists for ─────────────────────────────────────────────
 *
 * `setup.ps1` is the only documented way to stand this application up on a
 * fresh Windows machine, and nothing in CI runs it — there is no Windows job,
 * and a PowerShell script is not type-checked, linted or imported by anything.
 * So it drifted: the demo seed grew a third gate (`ALLOW_DEMO_SEED=yes`,
 * demanded explicitly on every run — see the comment block at the top of
 * prisma/seed/index.ts) and `setup.ps1` was never taught to answer it. Its last
 * step therefore failed on every machine, every time, and its own error text
 * told the operator to run the whole thing again — which reinstalled 630
 * packages and failed at the same step.
 *
 * These are the invariants a static read can actually hold: that the answer is
 * supplied where the seed runs, that it is supplied per-run rather than parked
 * in `.env` where it would answer the gate permanently, and that every npm
 * script the bootstrap invokes still exists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const webRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(webRoot, '../..');

const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');
const setup = read('setup.ps1');

/** Every launcher that shells out to npm, and so depends on package.json. */
const LAUNCHERS = ['setup.ps1', 'start.ps1', 'stop.ps1', 'start-demo.cmd'];

describe('setup.ps1 and the demo seed gate', () => {
  it('supplies ALLOW_DEMO_SEED before it runs the seed', () => {
    const granted = setup.indexOf("$env:ALLOW_DEMO_SEED = 'yes'");
    const seeded = setup.indexOf('npm run db:seed');
    expect(granted, 'setup.ps1 never sets ALLOW_DEMO_SEED').toBeGreaterThan(-1);
    expect(seeded, 'setup.ps1 never runs the seed').toBeGreaterThan(-1);
    expect(granted).toBeLessThan(seeded);
  });

  it('clears ALLOW_DEMO_SEED again rather than leaving it set', () => {
    expect(setup).toMatch(/Remove-Item[^\n]*ALLOW_DEMO_SEED/);
  });

  /**
   * The seed reads `.env` through dotenv, so a line there would satisfy gate 3
   * for every future run — including the run nobody meant to make.
   */
  it('never writes the answer into an env file', () => {
    for (const file of ['.env.example', 'apps/web/.env.example']) {
      expect(read(file), `${file} pre-answers the demo seed gate`).not.toContain('ALLOW_DEMO_SEED');
    }
    expect(setup).not.toMatch(/Set-Content[^\n]*ALLOW_DEMO_SEED/);
    expect(setup).not.toMatch(/Add-Content[^\n]*ALLOW_DEMO_SEED/);
  });
});

describe('the launchers only call npm scripts that exist', () => {
  const scripts = new Set(
    Object.keys(
      (
        JSON.parse(readFileSync(path.join(webRoot, 'package.json'), 'utf8')) as {
          scripts: Record<string, string>;
        }
      ).scripts,
    ),
  );

  const called = (file: string) =>
    [...read(file).matchAll(/npm run (?:--silent\s+)?([a-z0-9:_-]+)/gi)].map((match) => match[1]!);

  /**
   * Both halves of the comparison, because either one going empty would make
   * every assertion below pass without checking anything: a package.json that
   * failed to parse into scripts, or a regex that stopped matching the way the
   * launchers spell the call.
   */
  it('reads both sides of the comparison', () => {
    expect(scripts.size).toBeGreaterThan(10);
    expect(LAUNCHERS.flatMap(called).length).toBeGreaterThanOrEqual(4);
  });

  for (const file of LAUNCHERS) {
    it(`${file} names only defined scripts`, () => {
      for (const name of called(file)) {
        expect(scripts.has(name), `${file} runs "npm run ${name}", which package.json does not define`).toBe(true);
      }
    });
  }
});
