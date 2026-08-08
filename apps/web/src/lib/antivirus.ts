/**
 * Malware scanning for uploaded files.
 *
 * The contract every provider here obeys, and the reason this module exists at
 * all: **a scanner that cannot reach its engine returns ERROR, never CLEAN.**
 * A fabricated clean verdict is worse than having no scanner, because it reads
 * as a control that is working. Callers gate access on CLEAN specifically, not
 * on "not INFECTED", so an ERROR keeps the file quarantined.
 *
 * `clamav` speaks clamd's INSTREAM protocol directly over TCP. That needs no
 * dependency — it is a length-prefixed byte stream and a one-line reply — and
 * clamd is the standard way to run this on a server or as a sidecar container.
 */
import { connect } from 'node:net';
import { env } from './env';
import { logger } from './logger';

export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'ERROR';

export interface ScanResult {
  verdict: ScanVerdict;
  provider: string;
  /** Engine and signature-database version, when the provider reports one. */
  signature: string | null;
  /** The malware name for INFECTED, or the failure reason for ERROR. */
  detail: string | null;
  scannedAt: Date;
}

/** Streams the payload to clamd and reads its verdict. */
async function clamavScan(payload: Buffer): Promise<ScanResult> {
  const scannedAt = new Date();
  const base = { provider: 'clamav', scannedAt };

  try {
    const [reply, version] = await Promise.all([instream(payload), clamdVersion().catch(() => null)]);

    // clamd answers "stream: OK" or "stream: <Name> FOUND" or "... ERROR".
    if (/\bOK\s*$/.test(reply)) return { ...base, verdict: 'CLEAN', signature: version, detail: null };
    if (/\bFOUND\s*$/.test(reply)) {
      return {
        ...base,
        verdict: 'INFECTED',
        signature: version,
        detail: reply.replace(/^stream:\s*/, '').replace(/\s*FOUND\s*$/, ''),
      };
    }
    return {
      ...base,
      verdict: 'ERROR',
      signature: version,
      detail: `Unrecognised scanner reply: ${reply.slice(0, 120)}`,
    };
  } catch (error) {
    // Unreachable, timed out, refused — all the same answer: we do not know.
    logger.error({ err: error, host: env.CLAMAV_HOST, port: env.CLAMAV_PORT }, 'antivirus: scan failed');
    return { ...base, verdict: 'ERROR', signature: null, detail: (error as Error).message.slice(0, 200) };
  }
}

function instream(payload: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT });
    socket.setTimeout(env.ANTIVIRUS_TIMEOUT_MS);

    let reply = '';
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      // Chunked, each chunk preceded by its length; a zero-length chunk ends it.
      const CHUNK = 64 * 1024;
      for (let offset = 0; offset < payload.length; offset += CHUNK) {
        const slice = payload.subarray(offset, offset + CHUNK);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(slice.length);
        socket.write(header);
        socket.write(slice);
      }
      socket.write(Buffer.from([0, 0, 0, 0]));
    });
    socket.on('data', (chunk) => {
      reply += chunk.toString('utf8');
    });
    socket.on('end', () => resolve(reply.replace(/\0/g, '').trim()));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`clamd did not answer within ${env.ANTIVIRUS_TIMEOUT_MS} ms`));
    });
    socket.on('error', reject);
  });
}

function clamdVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT });
    socket.setTimeout(env.ANTIVIRUS_TIMEOUT_MS);
    let reply = '';
    socket.on('connect', () => socket.write('zVERSION\0'));
    socket.on('data', (chunk) => {
      reply += chunk.toString('utf8');
    });
    socket.on('end', () => resolve(reply.replace(/\0/g, '').trim()));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('clamd version timeout'));
    });
    socket.on('error', reject);
  });
}

/**
 * Test-only provider.
 *
 * It does **not** return a blanket clean result: it detects the EICAR test
 * string, which is the industry-standard harmless file every real scanner also
 * flags. That means the infected path is exercised by the test suite rather than
 * only the happy path, and it means this provider cannot be mistaken for
 * protection — it recognises exactly one thing.
 */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

function mockScan(payload: Buffer): ScanResult {
  const infected = payload.includes(EICAR);
  return {
    verdict: infected ? 'INFECTED' : 'CLEAN',
    provider: 'mock',
    signature: 'mock-eicar-only',
    detail: infected ? 'Eicar-Test-Signature' : null,
    scannedAt: new Date(),
  };
}

/**
 * Scans one payload.
 *
 * In production the env schema forbids `mock`, so a deployment cannot
 * accidentally run with the test provider and believe it is scanning.
 */
export async function scanBuffer(payload: Buffer): Promise<ScanResult> {
  switch (env.ANTIVIRUS_PROVIDER.toLowerCase()) {
    case 'clamav':
      return clamavScan(payload);
    case 'mock':
      return mockScan(payload);
    default:
      logger.error({ provider: env.ANTIVIRUS_PROVIDER }, 'antivirus: unknown provider configured');
      return {
        verdict: 'ERROR',
        provider: env.ANTIVIRUS_PROVIDER,
        signature: null,
        detail: 'No malware scanner is configured.',
        scannedAt: new Date(),
      };
  }
}

/** Whether a scanner is reachable right now — for the readiness endpoint. */
export async function antivirusHealth(): Promise<{ ready: boolean; provider: string; detail: string }> {
  const provider = env.ANTIVIRUS_PROVIDER.toLowerCase();
  if (provider === 'mock') {
    return { ready: true, provider, detail: 'Test provider: recognises the EICAR test file only. Not protection.' };
  }
  if (provider !== 'clamav') {
    return {
      ready: false,
      provider,
      detail: 'No malware scanner is configured. Uploads will be quarantined and cannot be downloaded.',
    };
  }
  try {
    const version = await clamdVersion();
    return { ready: true, provider, detail: version };
  } catch (error) {
    return {
      ready: false,
      provider,
      detail: `clamd at ${env.CLAMAV_HOST}:${env.CLAMAV_PORT} is unreachable: ${(error as Error).message}`,
    };
  }
}
