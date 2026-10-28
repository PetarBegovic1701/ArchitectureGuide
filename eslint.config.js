import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'schema/**',
      '**/test-results/**',
      '**/playwright-report/**',
      // Sample repositories the analyzer reads; not part of this codebase.
      'packages/analyzer/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        // `_`-prefixed names drop fields when destructuring (`{ source: _source, ...rest }`).
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
