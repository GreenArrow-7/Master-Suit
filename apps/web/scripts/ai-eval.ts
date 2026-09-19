/**
 * Runs the live-coach golden set through the real model and reports agreement
 * with the golden labels. Needs GEMINI_API_KEY (or a workspace key via
 * --tenant <id>). See docs/AI-EVALS.md for the floors this enforces.
 *
 *   npx tsx scripts/ai-eval.ts [--tenant <tenantId>]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { coachTick, detectStage } from '../src/lib/ai/liveCoach';

interface Scenario {
  id: string;
  lines: number;
  transcript: string;
  expectedStage: string;
  expectedHintKinds: string[];
  mustNotMention?: string[];
}

const STAGE_FLOOR = 0.9;
const tenantArg = process.argv.indexOf('--tenant');
const tenantId = tenantArg === -1 ? undefined : process.argv[tenantArg + 1];

async function main() {
  const scenarios: Scenario[] = JSON.parse(
    readFileSync(path.join(process.cwd(), 'tests', 'ai', 'golden', 'live-coach.json'), 'utf8'),
  );
  let stageOk = 0;
  let kindsOk = 0;
  let kindsTotal = 0;
  let grounded = 0;
  let simulated = 0;

  for (const s of scenarios) {
    const hints = await coachTick(s.transcript, tenantId);
    const stage = detectStage(s.transcript, s.lines);
    const kinds: string[] = hints.map((h) => h.kind);
    const missing = s.expectedHintKinds.filter((k) => !kinds.includes(k));
    const leaks = (s.mustNotMention ?? []).filter((term) =>
      hints.some((h) => `${h.text} ${h.say ?? ''} ${h.why ?? ''}`.toLowerCase().includes(term.toLowerCase())),
    );
    if (stage === s.expectedStage) stageOk += 1;
    if (s.expectedHintKinds.length) {
      kindsTotal += 1;
      if (!missing.length) kindsOk += 1;
    }
    grounded += leaks.length;
    if (hints.some((h) => h.source === 'simulated')) simulated += 1;
    console.log(
      `${s.id.padEnd(28)} stage ${stage === s.expectedStage ? 'ok ' : 'MISS'} hints ${kinds.join(',') || '-'}${missing.length ? ` missing ${missing.join(',')}` : ''}${leaks.length ? ` LEAK ${leaks.join(',')}` : ''}`,
    );
  }

  const stageRate = stageOk / scenarios.length;
  console.log(
    `\nstage agreement ${(stageRate * 100).toFixed(0)}% (floor ${STAGE_FLOOR * 100}%) · hint kinds ${kindsOk}/${kindsTotal} · groundedness violations ${grounded} · simulated answers ${simulated}/${scenarios.length}`,
  );
  if (simulated === scenarios.length)
    console.log(
      'every answer was simulated — no model key was available, so this measured the deterministic layer only',
    );
  const pass = stageRate >= STAGE_FLOOR && kindsOk === kindsTotal && grounded === 0;
  process.exit(pass ? 0 : 1);
}

void main();
