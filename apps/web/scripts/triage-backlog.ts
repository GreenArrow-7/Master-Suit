/**
 * Bring leads that were already unassigned into the triage queue.
 *
 *   tsx --env-file=.env scripts/triage-backlog.ts count [tenantId]
 *   tsx --env-file=.env scripts/triage-backlog.ts import --apply [tenantId]
 *
 * `count` is read-only and writes nothing. It groups by tenant and by lifecycle
 * state so the number that will be imported is separable from the numbers that
 * will not: leads already queued, leads in a closed stage, leads soft-deleted.
 *
 * `import` opens one episode per eligible lead, marked `PRE_EXISTING` and
 * `historyUnknown`. It invents no waiting time and no failure reason — see
 * `src/services/distribution/triageBacklog.ts`.
 *
 * Repeatable by construction: a second run finds every lead already queued and
 * opens nothing, so `imported=0` on a re-run is the expected result rather than
 * a sign something went wrong.
 */
import { countBacklog, importBacklog } from '../src/services/distribution/triageBacklog';
import { prisma } from '../src/lib/db';

const [command, ...rest] = process.argv.slice(2);
const apply = rest.includes('--apply');
const tenantArg = rest.find((a) => !a.startsWith('--'));

async function main() {
  if (command === 'count') {
    const rows = await countBacklog(tenantArg);
    if (rows.length === 0) {
      console.log('[triage-backlog] no workspace has an unassigned lead.');
      return;
    }
    let eligible = 0;
    for (const r of rows) {
      eligible += r.eligible;
      console.log(
        `tenant=${r.tenantId} eligible=${r.eligible} alreadyQueued=${r.alreadyQueued} ` +
          `closedStage=${r.closedStage} deleted=${r.deleted}`,
      );
    }
    console.log(
      `\n[triage-backlog] ${eligible} lead(s) would enter the queue. ` +
        'Excluded: already queued, closed stage (won/lost/finished), soft-deleted.',
    );
    return;
  }

  if (command === 'import') {
    if (!apply) {
      // The dry run is `count`. An import that silently did nothing would be a
      // worse answer than a refusal.
      console.error('[triage-backlog] import needs --apply. Run `count` for the read-only report.');
      process.exit(2);
    }
    const targets = tenantArg ? [tenantArg] : (await countBacklog()).map((r) => r.tenantId);
    let imported = 0;
    let skipped = 0;
    for (const tenantId of targets) {
      const r = await importBacklog(tenantId, { apply: true });
      imported += r.imported;
      skipped += r.skipped;
      console.log(
        `tenant=${r.tenantId} considered=${r.considered} imported=${r.imported} skipped=${r.skipped} ` +
          (Object.keys(r.skippedBy).length ? JSON.stringify(r.skippedBy) : ''),
      );
    }
    console.log(`\n[triage-backlog] imported=${imported} skipped=${skipped}.`);
    if (skipped > 0) {
      console.log(
        '[triage-backlog] skipped leads changed between the scan and the write — assigned, ' +
          'deleted, moved to a closed stage, or queued by a concurrent run. Re-run `count` to confirm.',
      );
    }
    return;
  }

  console.error('[triage-backlog] usage: triage-backlog.ts count [tenantId] | import --apply [tenantId]');
  process.exit(2);
}

main()
  .catch((err) => {
    console.error('[triage-backlog]', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
