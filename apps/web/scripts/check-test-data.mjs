#!/usr/bin/env node
/**
 * Fails the build when prohibited test data is tracked in Git.
 *
 * See docs/TEST-DATA-POLICY.md. This is a safety net rather than a control: it
 * catches image files sitting in test directories and filenames that announce
 * themselves as identity documents. It cannot tell a synthetic face from a real
 * one, and it never will — that judgement stays with the person committing.
 *
 * It reads the Git index, not the working tree, because an ignored file on disk
 * is not the problem; a tracked one is.
 */
import { execSync } from 'node:child_process';

const IMAGE = /\.(jpe?g|png|gif|bmp|tiff?|webp|heic|heif)$/i;

/** Directories where a committed image is almost certainly a personal fixture. */
const TEST_PATHS = [/(^|\/)tests?\//i, /(^|\/)__tests__\//i, /(^|\/)fixtures?\//i, /(^|\/)spec\//i];

/** Filenames that announce what they contain regardless of where they sit. */
const NAMED = [
  /passport/i, /emirates[-_ ]?id/i, /\bvisa\b/i, /labour[-_ ]?card/i,
  /driving[-_ ]?licen[cs]e/i, /national[-_ ]?id/i, /\bpayslip/i, /\bnbe\b/i,
  /(^|\/)faces?\//i, /\bselfie/i, /\bbiometric/i, /\bmugshot/i,
];

/** Known-problematic research images, by reputation rather than content. */
const KNOWN = [/\blena\b/i, /\blenna\b/i, /\bbarbara\b\.(jpe?g|png)/i, /\bmessi\b/i, /\bpeppers\b\.(jpe?g|png)/i];

/** Paths that are legitimately images and legitimately committed. */
const ALLOWED = [
  /^docs\/evidence\//,          // product screenshots, reviewed before commit
  /^apps\/web\/public\//,       // brand and UI assets
  /(^|\/)favicon\./,
  /\.svg$/i,                    // vector marks, not photographs
];

function tracked() {
  try {
    return execSync('git ls-files', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      .split('\n').map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    console.error('check-test-data: could not read the Git index.', error.message);
    process.exit(2);
  }
}

const findings = [];
for (const file of tracked()) {
  if (ALLOWED.some((pattern) => pattern.test(file))) continue;

  if (KNOWN.some((pattern) => pattern.test(file))) {
    findings.push([file, 'a known non-consensual research image']);
    continue;
  }
  if (NAMED.some((pattern) => pattern.test(file)) && (IMAGE.test(file) || /\.pdf$/i.test(file))) {
    findings.push([file, 'the filename indicates an identity document or face image']);
    continue;
  }
  if (IMAGE.test(file) && TEST_PATHS.some((pattern) => pattern.test(file))) {
    findings.push([file, 'an image committed inside a test directory']);
  }
}

if (findings.length === 0) {
  console.log('check-test-data: no prohibited test data is tracked.');
  process.exit(0);
}

console.error('\ncheck-test-data: prohibited test data is tracked in Git.\n');
for (const [file, reason] of findings) console.error(`  ${file}\n    ${reason}`);
console.error(`
${findings.length} file${findings.length === 1 ? '' : 's'} must not be committed.

Identifiable faces, identity documents and employee records do not belong in a
repository: Git keeps them in history, in every clone, forever. Supply them
locally instead — set FACE_TEST_IMAGES to a directory outside the repo, or use
one of the git-ignored paths in .gitignore.

See docs/TEST-DATA-POLICY.md.

If a finding is a false positive — a synthetic asset, or a UI screenshot with no
personal data — add it to ALLOWED in this script with a comment saying why.
`);
process.exit(1);
