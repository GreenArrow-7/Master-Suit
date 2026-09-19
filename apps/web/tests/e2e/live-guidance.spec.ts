import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { login, resetLoginThrottle } from './helpers';

/**
 * §8/§9 live guidance through the real route: consent gate, audio chunks →
 * transcript window → stage + hints on every tick, a customer objection in the
 * conversation raises an OBJECTION hint with something to say, and finishing
 * the call produces the analysis. Runs on the development mock transcription
 * (fixed conversation) with the heuristic coach unless a model key is present,
 * so what is asserted here is what a seller sees when the model is unavailable.
 */
const slug = process.env.E2E_DEMO_SLUG!;
const email = process.env.E2E_DEMO_EMAIL!;
const password = process.env.E2E_DEMO_PASSWORD!;
const base = () => process.env.APP_URL ?? 'http://localhost:3000';

test.describe('live call guidance', () => {
  test.skip(!slug || !email || !password, 'E2E_DEMO_SLUG / E2E_DEMO_EMAIL / E2E_DEMO_PASSWORD not set');
  test.beforeEach(resetLoginThrottle);
  test.setTimeout(4 * 60_000);

  test('consent gate → ticks return transcript, stage and hints → objection guidance → finalise → analysis', async ({
    page,
  }) => {
    await login(page, email, password);
    const api = (p: string) => `${base()}${p}`;
    const req = page.request;

    const leads = await (await req.get(api('/api/v1/leads?limit=1'))).json();
    const leadId = leads.data[0].id;
    const call = await (
      await req.post(api('/api/v1/calls'), { data: { leadId, recipientNumber: '+971501234567' } })
    ).json();

    const chunk = randomBytes(4000);
    const noConsent = await req.post(api(`/api/v1/calls/${call.id}/live-audio?tick=1`), {
      data: chunk,
      headers: { 'content-type': 'audio/webm' },
    });
    expect(noConsent.status(), 'audio is refused before consent').toBe(403);

    await req.post(api(`/api/v1/calls/${call.id}/consent`), { data: { consentGiven: true, method: 'VERBAL' } });

    const ticks: { text: string; hints: { kind: string; text: string; say?: string }[]; stage: string | null }[] = [];
    for (let tick = 1; tick <= 3; tick += 1) {
      const started = Date.now();
      const res = await req.post(api(`/api/v1/calls/${call.id}/live-audio?tick=${tick}`), {
        data: chunk,
        headers: { 'content-type': 'audio/webm' },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      const body = await res.json();
      test.info().annotations.push({ type: 'latency', description: `tick ${tick}: ${Date.now() - started} ms` });
      ticks.push(body);
    }
    // Transcript accumulates and the stage is named on every tick.
    expect(ticks[0].text.length).toBeGreaterThan(0);
    expect(ticks.every((t) => t.stage)).toBeTruthy();
    // The mock conversation contains "too expensive": the coach must react to it
    // with an objection hint the seller can act on.
    const objection = ticks.flatMap((t) => t.hints).find((h) => h.kind === 'OBJECTION');
    expect(objection, JSON.stringify(ticks.map((t) => t.hints))).toBeTruthy();
    expect(objection!.text.length).toBeGreaterThan(10);

    // Finishing the call: status COMPLETED with a duration, analysis produced.
    const done = await req.post(api(`/api/v1/calls/${call.id}/live-audio?final=true`), {
      data: Buffer.alloc(0),
      headers: { 'content-type': 'audio/webm' },
    });
    expect(done.ok(), await done.text()).toBeTruthy();
    const finished = await (await req.get(api(`/api/v1/calls/${call.id}`))).json();
    expect(finished.status).toBe('COMPLETED');

    let analysis: { status: string; modelId: string | null; objections: string[]; summary: string } | null = null;
    for (let i = 0; i < 60 && !analysis; i += 1) {
      const r = await req.get(api(`/api/v1/calls/${call.id}/analysis`));
      if (r.ok()) {
        const a = await r.json();
        if (a.status === 'COMPLETED') analysis = a;
        if (a.status === 'FAILED') throw new Error(`analysis failed: ${a.errorMessage}`);
      }
      if (!analysis) await new Promise((res) => setTimeout(res, 1500));
    }
    expect(analysis, 'analysis completed').toBeTruthy();
    // Whichever produced it, the record says so; a keyword pass is never presented as a model.
    expect(analysis!.modelId).toBeTruthy();
    if (analysis!.modelId === 'demo-simulation') expect(analysis!.summary).toMatch(/keyword|simulat|skipped/i);
  });
});
