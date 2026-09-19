// `cap sync` on Windows writes the iOS Swift package manifest with backslash
// paths (..\\..\\node_modules\\@capacitor\\...), which Swift Package Manager on a
// Mac cannot resolve. Run after every sync; a no-op on macOS or when clean.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ios/App/CapApp-SPM/Package.swift');
const before = readFileSync(file, 'utf8');
const after = before.replace(/path: "([^"]*)"/g, (_m, p) => `path: "${p.replaceAll('\\', '/')}"`);
if (after !== before) writeFileSync(file, after);
console.log(after !== before ? 'Package.swift: backslash paths normalised' : 'Package.swift: paths already portable');
