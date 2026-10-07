// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/*.tsbuildinfo'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        globalThis: 'readonly',
        NodeJS: 'readonly',
      },
    },
    rules: {
      // Unused args are fine when prefixed with _ — common for Express
      // middleware signatures where you must accept `next` but not use it.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // `{}` as a type is banned by default, but `(string & {})` is the
      // idiomatic way to model an open-ended string union, which we use for
      // VerificationMethod so an unrecognised value never breaks a build.
      '@typescript-eslint/no-empty-object-type': ['error', { allowWithName: '.*' }],

      // Prefer explicit unknown over any, but allow it in test doubles.
      '@typescript-eslint/no-explicit-any': 'warn',

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  {
    // Tests deliberately construct malformed values and cast aggressively.
    files: ['**/test/**/*.ts', 'examples/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
