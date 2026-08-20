import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSecretFiles } from '@/lib/env';

/**
 * Secrets read from a file rather than from the environment.
 *
 * Everything this deployment holds arrives as a process environment variable:
 * `.env.production` is passed into the containers wholesale. That is readable by
 * anything that can run `docker inspect`, visible in `/proc/<pid>/environ` to
 * every process sharing the namespace, and captured verbatim by most crash
 * reporters. A file with restrictive permissions is none of those.
 *
 * `<KEY>_FILE` is the convention every secret manager already speaks — Docker
 * secrets mount at `/run/secrets/<name>`, Kubernetes mounts a Secret as a volume,
 * the Key Vault CSI driver writes files — so this is the code-side half of
 * P2-9 with no SDK and no adapter in the application.
 */

const KEY_A = 'wvfXEiXl40UismLK9zO4OgZWgo2WGcZWiXMaVqqpyfY=';
const KEY_B = 'Ftk1BEc6Gp0lHXtG0BsPbCekIBqEXglm0YZ5PsevKQY=';

const withFile = (contents: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'secret-')), 'field_key');
  writeFileSync(file, contents);
  return file;
};

describe('<KEY>_FILE', () => {
  it('reads the secret from the file instead of the variable', () => {
    // The file wins, so a deployment can migrate one secret at a time without
    // first having to remove the variable everywhere it is set.
    const resolved = resolveSecretFiles({
      FIELD_ENCRYPTION_KEY: KEY_A,
      FIELD_ENCRYPTION_KEY_FILE: withFile(KEY_B),
    });
    expect(resolved.FIELD_ENCRYPTION_KEY).toBe(KEY_B);
  });

  it('trims the trailing newline every editor and secret manager adds', () => {
    // A base64 key with \n on the end fails its decoded-length check with a
    // message that says nothing about a newline, which is a long afternoon.
    const resolved = resolveSecretFiles({ FIELD_ENCRYPTION_KEY_FILE: withFile(`${KEY_B}\n`) });
    expect(resolved.FIELD_ENCRYPTION_KEY).toBe(KEY_B);
  });

  it('throws when the file is named but missing', () => {
    // Loudly. Falling back to the variable would mean a deployment that believes
    // it moved a secret into a vault and quietly did not.
    expect(() => resolveSecretFiles({ FIELD_ENCRYPTION_KEY_FILE: '/definitely/not/here' })).toThrow(
      /Could not read FIELD_ENCRYPTION_KEY_FILE.*readable by the process at start/s,
    );
  });

  it('ignores a _FILE variable for a key this application does not declare', () => {
    // SSL_CERT_FILE and LANG_FILE are ordinary parts of a Linux environment.
    // Reading them would fail the boot over a file that is not ours.
    expect(() => resolveSecretFiles({ SSL_CERT_FILE: '/definitely/not/here', LANG_FILE: '/nor/here' })).not.toThrow();
  });

  it('leaves every other variable exactly as it found it', () => {
    const source = { LOG_LEVEL: 'warn', S3_BUCKET: 'b', FIELD_ENCRYPTION_KEY_FILE: withFile(KEY_B) };
    const resolved = resolveSecretFiles(source);
    expect(resolved.LOG_LEVEL).toBe('warn');
    expect(resolved.S3_BUCKET).toBe('b');
    // And it does not mutate its input: env.ts passes process.env, and quietly
    // rewriting the real process environment would put the secret straight back
    // into /proc/<pid>/environ, which is the thing this avoids.
    expect(source).not.toHaveProperty('FIELD_ENCRYPTION_KEY');
  });
});
