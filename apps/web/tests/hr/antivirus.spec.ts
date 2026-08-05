import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * The malware-scanning contract.
 *
 * The property that matters is negative: a scanner that cannot reach its engine
 * must return ERROR, never CLEAN. Everything downstream gates on CLEAN
 * specifically, so getting this wrong turns an outage into a silent
 * wave-through of unscanned files.
 */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

async function withProvider(provider: string, run: () => Promise<void>) {
  vi.resetModules();
  const previous = process.env.ANTIVIRUS_PROVIDER;
  process.env.ANTIVIRUS_PROVIDER = provider;
  try { await run(); } finally {
    if (previous === undefined) delete process.env.ANTIVIRUS_PROVIDER;
    else process.env.ANTIVIRUS_PROVIDER = previous;
    vi.resetModules();
  }
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('mock provider (tests only)', () => {
  it('detects the EICAR test file rather than blanket-approving', async () => {
    await withProvider('mock', async () => {
      const { scanBuffer } = await import('@/lib/antivirus');
      const result = await scanBuffer(Buffer.from(`prefix ${EICAR} suffix`));
      expect(result.verdict).toBe('INFECTED');
      expect(result.detail).toMatch(/eicar/i);
    });
  });

  it('passes an ordinary file', async () => {
    await withProvider('mock', async () => {
      const { scanBuffer } = await import('@/lib/antivirus');
      const result = await scanBuffer(Buffer.from('%PDF-1.4 an ordinary document'));
      expect(result.verdict).toBe('CLEAN');
      expect(result.provider).toBe('mock');
    });
  });

  it('records the signature version it judged with', async () => {
    await withProvider('mock', async () => {
      const { scanBuffer } = await import('@/lib/antivirus');
      const result = await scanBuffer(Buffer.from('anything'));
      expect(result.signature).toBeTruthy();
      expect(result.scannedAt).toBeInstanceOf(Date);
    });
  });
});

describe('fail closed', () => {
  it('returns ERROR, never CLEAN, when clamd is unreachable', async () => {
    await withProvider('clamav', async () => {
      // Port 1 is reserved and nothing listens on it, so this is a genuine
      // connection failure rather than a stubbed one.
      process.env.CLAMAV_PORT = '1';
      process.env.ANTIVIRUS_TIMEOUT_MS = '1500';
      const { scanBuffer } = await import('@/lib/antivirus');
      const result = await scanBuffer(Buffer.from('%PDF-1.4 harmless'));
      expect(result.verdict).toBe('ERROR');
      expect(result.verdict).not.toBe('CLEAN');
      expect(result.detail).toBeTruthy();
      delete process.env.CLAMAV_PORT;
      delete process.env.ANTIVIRUS_TIMEOUT_MS;
    });
  }, 20_000);

  it('returns ERROR when no scanner is configured at all', async () => {
    await withProvider('none-configured', async () => {
      const { scanBuffer } = await import('@/lib/antivirus');
      const result = await scanBuffer(Buffer.from('%PDF-1.4 harmless'));
      expect(result.verdict).toBe('ERROR');
      expect(result.detail).toMatch(/no malware scanner/i);
    });
  });

  it('reports itself as not ready when unconfigured, so readiness checks fail', async () => {
    await withProvider('none-configured', async () => {
      const { antivirusHealth } = await import('@/lib/antivirus');
      const health = await antivirusHealth();
      expect(health.ready).toBe(false);
    });
  });

  it('does not describe the mock provider as protection', async () => {
    await withProvider('mock', async () => {
      const { antivirusHealth } = await import('@/lib/antivirus');
      const health = await antivirusHealth();
      expect(health.ready).toBe(true);
      expect(health.detail).toMatch(/not protection/i);
    });
  });
});
