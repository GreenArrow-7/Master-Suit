import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The migration runner must be built from the tree being deployed.
 *
 * `migrate` is declared with `profiles: ['tools']`, and Compose does not build
 * services whose profile is inactive — so `docker compose build` skips it.
 * `run --rm migrate` then starts whatever `<project>-migrate:latest` already
 * exists on the host, which is the image built during the *previous* release,
 * carrying that release's `prisma/migrations`.
 *
 * On 2026-09-25 that put a release into production whose two migrations were
 * never applied. The runner reported "87 migrations found in prisma/migrations"
 * against a tree holding 89, concluded there was nothing pending, and exited 0.
 * The deploy reported success and left new code on the old schema.
 *
 * The direction of the failure is what makes it dangerous: a stale image finds
 * *fewer* migrations than exist, so the staging-first gate has nothing to refuse
 * and everything downstream sees a clean run. Nothing distinguishes it from a
 * database that was genuinely up to date.
 *
 * Asserted against the script's text because there is no way to run a deploy in
 * a unit test, and the property is a property of the script: the runner is built
 * immediately before it is used, on every path.
 */
const web = path.join(__dirname, '..', '..');
const release = readFileSync(path.join(web, 'scripts', 'release.sh'), 'utf8');

describe('the migration runner cannot be stale', () => {
  it('builds migrate before running it', () => {
    const build = release.indexOf('--profile tools build migrate');
    const run = release.indexOf('--profile tools run --rm migrate');

    expect(build, 'release.sh never builds the migrate service').toBeGreaterThan(-1);
    expect(run, 'release.sh never runs the migrate service').toBeGreaterThan(-1);
    expect(build, 'migrate is run before it is built').toBeLessThan(run);
  });

  /**
   * The build must not sit inside the "image already exists" branch. On a
   * promotion nothing is rebuilt, which is exactly when the runner is most
   * likely to be from an older release.
   */
  it('builds the runner unconditionally, not only when the app image is missing', () => {
    const build = release.indexOf('--profile tools build migrate');
    const promotionBranch = release.indexOf('already exists — promoting it');
    const branchEnd = release.indexOf('\nfi', promotionBranch);

    expect(promotionBranch).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(promotionBranch);
    // After the if/else that decides whether to build web and worker.
    expect(build, 'the migrate build is inside the conditional image block').toBeGreaterThan(branchEnd);
  });

  it('runs migrations before starting the new containers', () => {
    const run = release.indexOf('--profile tools run --rm migrate');
    // `lastIndexOf`, because rollback also brings containers up and does so
    // earlier in the file — deliberately without migrating, since
    // `migrate deploy` has no down-path. The deploy path is the later one.
    const up = release.lastIndexOf('up -d --no-build');
    expect(up).toBeGreaterThan(-1);
    expect(up, 'rollback and deploy both matched the same line').not.toBe(release.indexOf('up -d --no-build'));
    // Additive migrations land while the old container is still serving.
    expect(run).toBeLessThan(up);
  });
});

describe('the assumption behind the fix still holds', () => {
  /**
   * If `migrate` ever stops being profile-gated, `docker compose build` would
   * cover it and the explicit build becomes redundant — harmless, but the
   * comment explaining it would be wrong. This is the tripwire for that.
   */
  it('migrate is still declared behind the tools profile', () => {
    const compose = readFileSync(path.join(web, 'infra', 'docker-compose.azure.yml'), 'utf8');
    const service = compose.slice(compose.indexOf('\n  migrate:'));
    const nextService = service.slice(1).search(/\n {2}\w[\w-]*:/);
    const block = nextService === -1 ? service : service.slice(0, nextService + 1);
    expect(block).toMatch(/profiles:\s*\['tools'\]/);
  });

  /**
   * The runner reads migrations from the working tree, which is only safe
   * because release.sh already refuses to deploy a tag that is not checked out.
   * Drop that check and building the runner from the tree stops being correct.
   */
  it('release.sh still refuses to deploy a tag the tree is not on', () => {
    expect(release).toContain('HEAD_TAG=');
    expect(release).toMatch(/if \[ "\$\{TAG\}" != "\$\{HEAD_TAG\}" \]; then/);
  });
});
