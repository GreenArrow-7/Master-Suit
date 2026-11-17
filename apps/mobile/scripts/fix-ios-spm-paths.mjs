// `cap sync` on Windows writes the iOS Swift package manifest with backslash
// paths (..\\..\\node_modules\\@capacitor\\...), which Swift Package Manager on a
// Mac cannot resolve. Run after every sync; a no-op on macOS or when clean.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ios/App/CapApp-SPM/Package.swift');
const before = readFileSync(file, 'utf8');
const after = before.replace(/path: "([^"]*)"/g, (_m, p) => `path: "${p.replaceAll('\\', '/')}"`);
// --check writes nothing and exits 1 instead, so CI fails on a manifest
// committed from a Windows `cap sync` that skipped this script.
if (after === before) {
  console.log('Package.swift: paths already portable');
} else if (process.argv.includes('--check')) {
  console.error('Package.swift: a `path:` holds backslashes — run `npm run sync` and commit the result');
  process.exit(1);
} else {
  writeFileSync(file, after);
  console.log('Package.swift: backslash paths normalised');
}
