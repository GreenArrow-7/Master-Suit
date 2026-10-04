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
  vi.stubEnv('ANTIVIRUS_PROVIDER', provider);
  try {
    await run();
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
});

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
      vi.stubEnv('CLAMAV_PORT', '1');
      vi.stubEnv('ANTIVIRUS_TIMEOUT_MS', '1500');
      const { scanBuffer } = await import('@/lib/antivirus');
      const result = await scanBuffer(Buffer.from('%PDF-1.4 harmless'));
      expect(result.verdict).toBe('ERROR');
      expect(result.verdict).not.toBe('CLEAN');
      expect(result.detail).toBeTruthy();
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
});
