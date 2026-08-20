/**
 * The schema's own numbers, so the README cannot claim different ones.
 *
 * `apps/web/README.md` said "79 models, 25 enums, 119 indexes" against a schema
 * holding 192, 103 and 332. That is the assessment's W-13: the first file a
 * newcomer opens was wrong, and a reader who catches one wrong number stops
 * trusting the rest of the page.
 *
 * Counting them by hand and pasting the result is how it got that way, so this
 * counts them and CI checks the paste:
 *
 *   node scripts/schema-stats.mjs            print the current numbers
 *   node scripts/schema-stats.mjs --write    update the README block
 *   node scripts/schema-stats.mjs --check    exit 1 if the README disagrees
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8');

const count = (pattern) => (schema.match(pattern) ?? []).length;
const stats = {
  models: count(/^model \w+ \{/gm),
  enums: count(/^enum \w+ \{/gm),
  indexes: count(/^\s*@@index\(/gm),
  uniques: count(/^\s*@@unique\(/gm),
};

/**
 * Between the markers, so the sentence around it stays editable prose. A
 * generator that owns a whole file is one nobody may improve.
 */
const START = '<!-- schema-stats:start -->';
const END = '<!-- schema-stats:end -->';
// Prettier reflows Markdown, and it puts a blank line after an HTML comment.
// Emitting the shape prettier would produce keeps `--check` and `format:check`
// from disagreeing with each other, which is the sort of loop that gets a gate
// switched off again.
const line = `${stats.models} models · ${stats.enums} enums · ${stats.indexes} indexes · ${stats.uniques} unique constraints`;
const block = `${START}\n\n${line}\n${END}`;

const readmePath = join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const region = new RegExp(`${START}[\\s\\S]*?${END}`);

if (!region.test(readme)) {
  console.error(`[schema-stats] README.md has no ${START} … ${END} block to fill.`);
  process.exit(2);
}

if (process.argv.includes('--write')) {
  writeFileSync(readmePath, readme.replace(region, block));
  console.log(`[schema-stats] README updated: ${stats.models} models, ${stats.enums} enums, ${stats.indexes} indexes.`);
} else if (process.argv.includes('--check')) {
  if (region.exec(readme)[0] !== block) {
    console.error(
      '[schema-stats] README.md disagrees with prisma/schema.prisma.\n' +
        `  schema says: ${stats.models} models, ${stats.enums} enums, ${stats.indexes} indexes, ${stats.uniques} uniques\n` +
        '  Run: node scripts/schema-stats.mjs --write',
    );
    process.exit(1);
  }
  console.log('[schema-stats] README matches the schema.');
} else {
  console.log(JSON.stringify(stats, null, 2));
}
