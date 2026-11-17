import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No shell script carries a carriage return.
 *
 * A `.sh` file saved with CRLF does not run. The kernel reads the shebang
 * `#!/usr/bin/env bash\r`, looks for an interpreter literally called `bash\r`,
 * and reports `bash\r: No such file or directory` — a message that names
 * neither the file nor the real problem.
 *
 * It happened on 11 November 2026. An edit made on Windows rewrote
 * `docs/release/production-release.sh` with CRLF on all 202 lines, and the
 * production release stopped dead with nothing else wrong: the script was
 * correct, its syntax was valid, and it could not start.
 *
 * `.gitattributes` now pins `*.sh` to `eol=lf`, which fixes it for anyone who
 * clones afterwards. This is the belt: `.gitattributes` governs what git
 * writes, and nothing stops a tool writing CRLF into the working tree and
 * committing it from a checkout that predates the rule. Catching it here costs
 * milliseconds; catching it on the production host costs a release window.
 */

const repoRoot = join(__dirname, '..', '..', '..', '..');

/** Tracked files only — never node_modules, never build output. */
function trackedShellScripts(): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '*.sh', '*.bash'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

describe('shell scripts are LF', () => {
  it('no tracked .sh or .bash file contains a carriage return', () => {
    const scripts = trackedShellScripts();
    // A guard that silently checks nothing is worse than no guard.
    expect(scripts.length).toBeGreaterThan(5);

    const offenders = scripts.filter((file) => readFileSync(join(repoRoot, file)).includes(0x0d));

    expect(
      offenders,
      offenders.length
        ? `CRLF in: ${offenders.join(', ')}\nRun: sed -i 's/\\r$//' <file>  — and check .gitattributes is in effect.`
        : '',
    ).toEqual([]);
  });

  it('the release script starts with a clean shebang', () => {
    // The one that broke, asserted directly: the first line must end in `bash`
    // and nothing else, because what follows it is what the kernel executes.
    const first = readFileSync(join(repoRoot, 'docs/release/production-release.sh'), 'utf8').split('\n')[0]!;
    expect(first).toBe('#!/usr/bin/env bash');
    expect(first.endsWith('\r')).toBe(false);
  });
});
