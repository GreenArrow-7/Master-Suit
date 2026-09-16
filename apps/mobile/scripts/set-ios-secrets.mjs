// Verifies the iOS signing files the Account Holder downloaded into this folder, then stores
// them as GitHub Actions secrets for GreenArrow-7/Master-Suit. Prints names and checks only —
// never a secret value.  node set-ios-secrets.mjs [signing-folder, default: current directory] [--dry-run]
//
// Expected files in the signing folder, beside distribution.key and the CSR it came from:
//   *.cer                 Apple Distribution certificate made from YOUHAN-ONE-Distribution.certSigningRequest
//   *.mobileprovision     App Store profile named "YOUHAN ONE App Store" for com.youhan.one
//   AuthKey_<KEYID>.p8    App Store Connect Team API key, Developer role (upload only)
//   issuer-id.txt         the Issuer ID shown above the Team Keys table (one line)
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const here = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.');
const TEAM = '3SHW6AX727';
const BUNDLE = 'com.youhan.one';
const PROFILE_NAME = 'YOUHAN ONE App Store';
const REPO = 'GreenArrow-7/Master-Suit';
const dryRun = process.argv.includes('--dry-run');
const problems = [];
const ok = (label) => console.log(`  ok   ${label}`);
const fail = (label) => {
  problems.push(label);
  console.log(`  FAIL ${label}`);
};
const openssl = (args, input) => execFileSync('openssl', args, { input, cwd: here, stdio: ['pipe', 'pipe', 'pipe'] });
const one = (suffix) => readdirSync(here).filter((f) => f.toLowerCase().endsWith(suffix));

console.log('Checking signing files in', here);
const keyFile = path.join(here, 'distribution.key');
const certs = one('.cer');
const profiles = one('.mobileprovision');
const apiKeys = readdirSync(here).filter((f) => /^AuthKey_[A-Z0-9]+\.p8$/.test(f));
const issuerFile = path.join(here, 'issuer-id.txt');
if (!existsSync(keyFile)) fail('distribution.key (the private key generated with the CSR) is missing');
if (certs.length !== 1) fail(`exactly one .cer expected, found ${certs.length}`);
if (profiles.length !== 1) fail(`exactly one .mobileprovision expected, found ${profiles.length}`);
if (apiKeys.length !== 1) fail(`exactly one AuthKey_<KEYID>.p8 expected, found ${apiKeys.length}`);
if (!existsSync(issuerFile)) fail('issuer-id.txt is missing');
if (problems.length) process.exit(1);

// Certificate: Apple Distribution, this team, and made from our private key.
const certDer = readFileSync(path.join(here, certs[0]));
const certText = openssl(['x509', '-inform', 'der', '-noout', '-subject', '-enddate', '-nameopt', 'RFC2253'], certDer).toString();
/CN=Apple Distribution/.test(certText) ? ok('certificate is an Apple Distribution certificate') : fail('certificate is not "Apple Distribution"');
new RegExp(`OU=${TEAM}`).test(certText) ? ok(`certificate team is ${TEAM}`) : fail(`certificate team is not ${TEAM}`);
const certNotAfter = certText.match(/notAfter=(.*)/)?.[1] ?? '';
new Date(certNotAfter) > new Date() ? ok(`certificate valid until ${certNotAfter}`) : fail(`certificate expired (${certNotAfter})`);
const certPub = openssl(['x509', '-inform', 'der', '-noout', '-pubkey'], certDer).toString();
const keyPub = openssl(['pkey', '-in', 'distribution.key', '-pubout']).toString();
certPub === keyPub ? ok('certificate matches distribution.key') : fail('certificate was not made from this folder\'s CSR/private key');

// Profile: App Store, this team, this bundle id, this name, includes this certificate.
const profileXml = openssl(['smime', '-inform', 'der', '-verify', '-noverify', '-in', profiles[0]]).toString();
const plistString = (key) => profileXml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1];
plistString('Name') === PROFILE_NAME ? ok(`profile name is "${PROFILE_NAME}"`) : fail(`profile name must be exactly "${PROFILE_NAME}"`);
profileXml.includes(`<key>TeamIdentifier</key>`) && profileXml.includes(`<string>${TEAM}</string>`)
  ? ok(`profile team is ${TEAM}`)
  : fail(`profile team is not ${TEAM}`);
plistString('application-identifier') === `${TEAM}.${BUNDLE}` ? ok(`profile is for ${BUNDLE}`) : fail(`profile is not for ${BUNDLE}`);
!profileXml.includes('<key>ProvisionedDevices</key>') ? ok('profile is App Store type (no device list)') : fail('profile lists devices: create an App Store profile, not Ad Hoc/Development');
!/<key>get-task-allow<\/key>\s*<true\/>/.test(profileXml) ? ok('profile is not a development profile') : fail('profile allows debugging: it is a development profile');
const expiry = profileXml.match(/<key>ExpirationDate<\/key>\s*<date>([^<]*)<\/date>/)?.[1];
expiry && new Date(expiry) > new Date() ? ok(`profile valid until ${expiry}`) : fail('profile expired or has no expiry');
profileXml.replace(/\s/g, '').includes(certDer.toString('base64'))
  ? ok('profile includes this certificate')
  : fail('profile does not include this certificate: select it when creating the profile');

// API key and issuer.
const keyId = apiKeys[0].match(/^AuthKey_([A-Z0-9]+)\.p8$/)[1];
const p8 = readFileSync(path.join(here, apiKeys[0]));
p8.toString().includes('BEGIN PRIVATE KEY') ? ok(`API key ${apiKeys[0].replace(keyId, '…')} is a .p8 private key`) : fail('the .p8 file is not a private key');
const issuer = readFileSync(issuerFile, 'utf8').trim();
/^[0-9a-f-]{36}$/i.test(issuer) ? ok('issuer id has the expected format') : fail('issuer-id.txt must hold the 36-character Issuer ID only');

if (problems.length) {
  console.log(`\n${problems.length} problem(s); nothing was stored.`);
  process.exit(1);
}

// .p12 with a random password, in a format macOS `security import` accepts.
const passwordFile = path.join(here, 'p12-password.txt');
const p12Password = existsSync(passwordFile) ? readFileSync(passwordFile, 'utf8').trim() : randomBytes(24).toString('hex');
if (!existsSync(passwordFile)) writeFileSync(passwordFile, p12Password, { mode: 0o600 });
execFileSync('openssl', ['x509', '-inform', 'der', '-in', certs[0], '-out', 'distribution.pem'], { cwd: here });
execFileSync(
  'openssl',
  ['pkcs12', '-export', '-inkey', 'distribution.key', '-in', 'distribution.pem', '-out', 'distribution.p12',
    '-name', 'YOUHAN ONE Distribution', '-passout', 'env:P12PASS',
    '-certpbe', 'PBE-SHA1-3DES', '-keypbe', 'PBE-SHA1-3DES', '-macalg', 'sha1'],
  { cwd: here, env: { ...process.env, P12PASS: p12Password } },
);
ok('distribution.p12 created (password kept in p12-password.txt beside it)');

const secrets = {
  IOS_DIST_CERT_P12_BASE64: readFileSync(path.join(here, 'distribution.p12')).toString('base64'),
  IOS_DIST_CERT_PASSWORD: p12Password,
  IOS_APPSTORE_PROFILE_BASE64: readFileSync(path.join(here, profiles[0])).toString('base64'),
  ASC_KEY_ID: keyId,
  ASC_ISSUER_ID: issuer,
  ASC_KEY_P8_BASE64: p8.toString('base64'),
};
const fingerprint = createHash('sha256').update(certDer).digest('hex').slice(0, 16);
console.log(`\nCertificate SHA-256 prefix: ${fingerprint}`);
if (dryRun) {
  console.log('Dry run: would set secrets', Object.keys(secrets).join(', '), 'and variable APPLE_TEAM_ID');
  process.exit(0);
}
for (const [name, value] of Object.entries(secrets)) {
  const r = spawnSync('gh', ['secret', 'set', name, '--repo', REPO], { input: value, stdio: ['pipe', 'ignore', 'pipe'], shell: false });
  r.status === 0 ? ok(`secret ${name} set`) : fail(`secret ${name} not set: ${r.stderr.toString().trim()}`);
}
const v = spawnSync('gh', ['variable', 'set', 'APPLE_TEAM_ID', '--repo', REPO, '--body', TEAM], { stdio: ['ignore', 'ignore', 'pipe'] });
v.status === 0 ? ok(`variable APPLE_TEAM_ID set to ${TEAM}`) : fail(`variable APPLE_TEAM_ID not set: ${v.stderr.toString().trim()}`);
process.exit(problems.length ? 1 : 0);
