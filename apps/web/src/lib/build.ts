import { execSync } from 'node:child_process';

/**
 * A short, non-secret identifier of what is actually running, so "which build
 * am I looking at" is answerable from the app itself. Deployments set
 * BUILD_COMMIT at build time; a source checkout falls back to git.
 */
let cached: string | null = null;

export function buildId(): string {
  if (cached) return cached;
  cached =
    process.env.BUILD_COMMIT ??
    (() => {
      try {
        return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
          .toString()
          .trim();
      } catch {
        return 'unknown';
      }
    })();
  return cached;
}
