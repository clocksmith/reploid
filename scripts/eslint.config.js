import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'artifacts/**', 'coverage/**', 'test-results/**', 'playwright-report/**',
    'self/vendor/**', 'self/core/vendor/**', '**/dist/**', 'self/lib/**', 'doppler/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.worker, ...globals.serviceworker } },
    rules: { 'no-undef': 'error',
      'no-restricted-globals': ['error', 'parent', 'name', 'event'], 'no-unreachable': 'error', 'no-dupe-args': 'error',
      'no-dupe-keys': 'error', 'no-constant-binary-expression': 'error', 'valid-typeof': 'error' }
  },
  { files: ['tests/**/*.js'], languageOptions: { globals: globals.vitest } }
];
