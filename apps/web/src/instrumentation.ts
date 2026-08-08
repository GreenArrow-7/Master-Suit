/**
 * Boot-time configuration gate.
 *
 * Next runs `register()` once per server process, before the first request is
 * served — and, unlike module evaluation in `lib/env.ts`, it does *not* run
 * during `next build`. That distinction is the whole point of this file: the
 * check below is about whether this process is fit to serve production traffic,
 * which a build server cannot and should not have to satisfy.
 *
 * The check itself lives in `lib/startup-check.ts` and is reached by dynamic
 * import, because this module is compiled for the Edge runtime as well and the
 * Node APIs it needs are not available there.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertProductionConfiguration } = await import('./lib/startup-check');
  await assertProductionConfiguration();
}
