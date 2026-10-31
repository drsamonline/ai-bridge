/**
 * Audit 3, F5 — there was no linter at all.
 *
 * Deliberately narrow: it enforces the handful of rules where a violation is a
 * bug, and nothing that would require re-formatting 20k lines. Type-aware rules
 * are left out on purpose — they need a full project graph, run slowly, and would
 * surface mostly noise in a codebase that already compiles under `strict`.
 */

import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'docs/**', '**/*.cjs', '**/*.mjs'],
  },
  {
    files: ['shared/src/**/*.ts', 'bridge/src/**/*.ts', 'extension/src/**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-var': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      // An empty block hides a swallowed error; a comment inside it is the
      // exemption, which is why every deliberate one is commented.
      'no-empty': ['error', { allowEmptyCatch: false }],
      // A `require()` in TypeScript is usually a mistake, or a deliberate lazy
      // import that deserves the disable comment it already carries.
      '@typescript-eslint/no-var-requires': 'error',
    },
  },
];
