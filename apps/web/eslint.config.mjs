import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import next from 'eslint-config-next';

/**
 * There was no lint configuration of any kind.
 *
 * `npm run lint` ran `next lint`, which Next 16 removed, so the script failed
 * with "Invalid project directory provided, no such directory: …/lint" — and
 * because it failed on invocation rather than on findings, nobody noticed the
 * codebase had never been linted.
 *
 * Ordering matters here: `eslint-config-next` sets its own parser, which does
 * not forward `parserOptions.project`, so the type-aware rules below must come
 * after it and re-declare the parser for TypeScript files. Putting them first
 * fails with "you have used a rule which requires type information".
 *
 * The rule set is deliberately small. A large one on a codebase this size
 * produces a wall of findings that gets blanket-disabled, which is worse than no
 * lint at all. These catch real defects.
 */
export default tseslint.config(
  {
    // `.next-prod` is the local production build (scripts/start-local-prod.mjs).
    // It was not ignored, so once anyone had run a production build `npm run
    // lint` reported ~36 500 errors in minified vendor chunks and became
    // unusable — the same omission that made `npm test` collect pino's Jest
    // suite out of the same directory.
    ignores: [
      '.next/**',
      '.next-prod/**',
      // Scratch verification scripts, already git-ignored.
      '.verify/**',
      'node_modules/**',
      'coverage/**',
      'src/generated/**',
      'next-env.d.ts',
      'eslint.config.mjs',
    ],
  },

  js.configs.recommended,
  ...next,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `any` is a deliberate escape hatch in the Prisma extension and the route
      // kernel, where the generic types are genuinely unresolvable. Warn, so it
      // stays visible without failing the build over the few that are correct.
      '@typescript-eslint/no-explicit-any': 'warn',

      // A real class of bug: an unawaited promise in a handler returns before
      // its write lands, and the request succeeds having done nothing.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],

      // An unused import after a refactor is usually a leftover reference to
      // something that has moved. Underscore-prefixed names are intentional.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],

      // `== null` is the idiom for "null or undefined" and is used deliberately.
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  {
    // Scripts, the seed and the test lifecycle hooks run on a terminal and
    // report to a human. A teardown that cleaned up silently would leave nobody
    // able to tell whether it ran.
    files: ['scripts/**', 'prisma/seed/**', 'prisma.config.ts', 'tests/**/global*.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    // Tests assert against loosely-typed API responses; `any` there is noise.
    files: ['tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  {
    /**
     * Signing out is the one navigation that must not be client-side.
     *
     * `@next/next/no-location-assign-relative-destination` is right almost
     * everywhere: `router.push` is faster and keeps the app alive. That is
     * exactly what makes it wrong here. Every flagged occurrence is
     * `window.location.href = '/login'` in a logout or session-expiry handler,
     * where a full document load is the point — it guarantees no component
     * state, context or cached RSC payload from the authenticated session
     * survives in memory. A soft navigation would leave all of it.
     *
     * Scoped to the three files that sign a user out; the rule stays on
     * everywhere else.
     */
    files: ['src/components/nav/TopBar.tsx', 'src/components/workspace/SecurityPanel.tsx', 'src/lib/auth/client.ts'],
    rules: { '@next/next/no-location-assign-relative-destination': 'off' },
  },

  {
    /**
     * `react-hooks/purity` is a React Compiler rule about *client* render
     * purity: a value read during render that changes between renders tears the
     * UI, because the compiler may re-run render without re-running effects.
     *
     * Every page.tsx and layout.tsx in this app is a Server Component — none of
     * them carry 'use client' (verified: `grep -rl "^'use client'" src/app
     * --include=page.tsx --include=layout.tsx` returns nothing). A Server
     * Component body runs exactly once per request on the server and its output
     * is serialised, so `Date.now()` there is a single reading of the clock at
     * request time, which is precisely what a "3 days until expiry" column
     * means. The rule has nothing to constrain.
     *
     * This is scoped to those two filenames on purpose. The rule stays on for
     * every client component, where it caught two genuine bugs: StageRail's
     * countdown and CalendarView's month anchor both read the clock mid-render
     * and disagreed between server and client on hydration.
     */
    files: ['src/app/**/page.tsx', 'src/app/**/layout.tsx'],
    rules: { 'react-hooks/purity': 'off' },
  },
);
