import js from '@eslint/js';
import globals from 'globals';
import { eslintQualityRulesV1 } from '@chester-hill-solutions/ratchet-strap';

// This repository is JavaScript; TypeScript-only detectors need no plugin here.
export const qualityRules = Object.fromEntries(Object.entries(eslintQualityRulesV1)
  .filter(([name]) => !name.startsWith('@typescript-eslint/')));

export default [
  { ignores: ['node_modules/**', 'tools/vendor/**', '.local/**'] },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: { ...js.configs.recommended.rules, ...qualityRules, 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
];
