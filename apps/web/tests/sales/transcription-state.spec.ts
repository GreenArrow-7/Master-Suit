/**
 * What a call says about its own transcription, against real rows.
 *
 * The gap this pins: a missing `Transcript` was the only signal, and it meant
 * four different things — never asked for, queued, deliberately not transcribed,
 * or beaten after every retry. Only the last needs a person, and nothing on the
 * call told them apart.
 *
 * Prisma is real here on purpose. A version of this suite with a mocked client
 * would assert that `update` was called with the right argument, which is a
 * statement about this file rather than about the database, and would keep
 * passing if the write never landed. Mocked instead are the three seams that
 * reach outside the process: object storage, the speech vendor, and the queue.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const transcribeMock = vi.fn();

vi.mock('@/lib/storage', () => ({
  getObject: async () => Buffer.from('not really audio'),
  putObject: async (key: string) => key,
  deleteObject: async () => undefined,
  moveObject: async (_from: string, to: string) => to,
}));
vi.mock('@/lib/queue', () => ({
  enqueue: vi.fn(),
  queueHasWorkers: async () => false,
}));
vi.mock('@/lib/integrations/transcription', () => ({
  transcriptionProviderFor: () => 'mock',
  getTranscriptionProvider: () => ({ transcribe: transcribeMock }),
}));
vi.mock('@/lib/integrations/connection', () => ({
  connectionCredentials: async () => ({ provider: 'mock' }),
}));

import { prisma } from '@/lib/db';
import { markTranscriptionExhausted, transcribeCall } from '@/services/shared/callIntelligence';

const suffix = randomBytes(4).toString('hex');
let tenantId: string;
let userId: string;

/** A call with a consented, ingested recording — the state every branch starts from. */
async function callReadyToTranscribe(): Promise<string> {
  const call = await prisma.call.create({
    data: { tenantId, callerId: userId, recipientNumber: '+971500000000', status: 'COMPLETED' },
  });
  await prisma.recordingConsent.create({
    data: { tenantId, callId: call.id, consentGiven: true, givenAt: new Date() },
  });
  await prisma.recording.create({
    data: { tenantId, callId: call.id, storageKey: `rec/${call.id}`, storageBucket: 'recordings' },
  });
  return call.id;
}

const stateOf = (callId: string) =>
  prisma.call.findFirstOrThrow({
    where: { id: callId, tenantId },
    select: {
      transcriptionState: true,
      transcriptionDetail: true,
      transcriptionAttempts: true,
      transcriptionUpdatedAt: true,
    },
  });

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `ts-${suffix}`, legalName: `ts-${suffix} LLC`, displayName: `ts-${suffix}` },
  });
  tenantId = tenant.id;
  const role = await prisma.role.create({
    data: { tenantId, key: `rep-${suffix}`, name: 'Rep', rank: 60, defaultScope: 'OWN' },
  });
  const user = await prisma.user.create({
    data: { tenantId, email: `rep@ts-${suffix}.test`, fullName: 'Rep', roleId: role.id, status: 'ACTIVE' },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
});

beforeEach(() => {
  transcribeMock.mockReset();
});

describe('transcription state on the call', () => {
  it('starts at PENDING, which is what a call nobody has asked about looks like', async () => {
    const callId = await callReadyToTranscribe();
    const state = await stateOf(callId);
    expect(state.transcriptionState).toBe('PENDING');
    expect(state.transcriptionAttempts).toBe(0);
    expect(state.transcriptionUpdatedAt).toBeNull();
  });

  it('records READY and the attempt when a transcript is produced', async () => {
    const callId = await callReadyToTranscribe();
    transcribeMock.mockResolvedValue({ text: 'hello there', provider: 'mock', confidence: 0.9 });

    await expect(transcribeCall({ tenantId, callId })).resolves.toEqual({ done: true });

    const state = await stateOf(callId);
    expect(state.transcriptionState).toBe('READY');
    expect(state.transcriptionAttempts).toBe(1);
    expect(state.transcriptionUpdatedAt).not.toBeNull();
  });

  it('says SKIPPED, and why, when consent is absent', async () => {
    const call = await prisma.call.create({
      data: { tenantId, callerId: userId, recipientNumber: '+971500000001', status: 'COMPLETED' },
    });

    await transcribeCall({ tenantId, callId: call.id });

    const state = await stateOf(call.id);
    expect(state.transcriptionState).toBe('SKIPPED');
    expect(state.transcriptionDetail).toMatch(/consent/i);
  });

  it('says SKIPPED when the audio held no speech, rather than leaving it pending for ever', async () => {
    const callId = await callReadyToTranscribe();
    transcribeMock.mockResolvedValue({ text: '', provider: 'mock' });

    await transcribeCall({ tenantId, callId });

    const state = await stateOf(callId);
    expect(state.transcriptionState).toBe('SKIPPED');
    expect(state.transcriptionDetail).toMatch(/no speech/i);
  });

  it('records RETRYING — never FAILED — when a run throws, and rethrows for the queue', async () => {
    const callId = await callReadyToTranscribe();
    transcribeMock.mockRejectedValue(new Error('deepgram returned 503'));

    await expect(transcribeCall({ tenantId, callId })).rejects.toThrow(/503/);

    const state = await stateOf(callId);
    // The distinction that matters: this function cannot see the attempt budget,
    // so it must not claim the transcription is beaten.
    expect(state.transcriptionState).toBe('RETRYING');
    expect(state.transcriptionDetail).toContain('deepgram returned 503');
    expect(state.transcriptionAttempts).toBe(1);
  });

  it('counts every run, so FAILED after four reads differently from FAILED after one', async () => {
    const callId = await callReadyToTranscribe();
    transcribeMock.mockRejectedValue(new Error('vendor down'));

    await expect(transcribeCall({ tenantId, callId })).rejects.toThrow();
    await expect(transcribeCall({ tenantId, callId })).rejects.toThrow();

    expect((await stateOf(callId)).transcriptionAttempts).toBe(2);
  });

  it('turns RETRYING into FAILED when the queue gives up, without inventing an extra attempt', async () => {
    const callId = await callReadyToTranscribe();
    transcribeMock.mockRejectedValue(new Error('vendor down'));
    await expect(transcribeCall({ tenantId, callId })).rejects.toThrow();

    await markTranscriptionExhausted(tenantId, callId, 'vendor down');

    const state = await stateOf(callId);
    expect(state.transcriptionState).toBe('FAILED');
    expect(state.transcriptionDetail).toBe('vendor down');
    // The run that failed was already counted. Counting the verdict too would
    // report one attempt more than the queue actually made.
    expect(state.transcriptionAttempts).toBe(1);
  });

  it('reports READY, not SKIPPED, for a replayed job whose transcript already exists', async () => {
    const callId = await callReadyToTranscribe();
    transcribeMock.mockResolvedValue({ text: 'first pass', provider: 'mock' });
    await transcribeCall({ tenantId, callId });

    // A redelivered job. The step does nothing, but the call has a transcript,
    // and the state describes the call rather than the run.
    await transcribeCall({ tenantId, callId });

    expect((await stateOf(callId)).transcriptionState).toBe('READY');
  });

  it('keeps the detail short enough to store and show', async () => {
    const callId = await callReadyToTranscribe();
    transcribeMock.mockRejectedValue(new Error('x'.repeat(5_000)));

    await expect(transcribeCall({ tenantId, callId })).rejects.toThrow();

    expect((await stateOf(callId)).transcriptionDetail!.length).toBe(500);
  });
});
