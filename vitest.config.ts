import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Ledger I1: the component-test toolchain (jsdom env + React plugin + `@/` alias) lands
 * here, before the first .tsx test in the repo.
 *
 * The brief specified `test.environmentMatchGlobs`, which Vitest removed in v3 (this repo
 * runs v4 — the key is silently ignored, so the component test would have run under node
 * and blown up on `document`). `test.projects` is the current equivalent and enforces the
 * same rule: ONLY tests/components/** gets jsdom; everything else stays on node.
 */
const shared = () => ({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});

export default defineConfig({
  ...shared(),
  test: {
    projects: [
      {
        ...shared(),
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
          exclude: ['**/node_modules/**', 'tests/components/**'],
        },
      },
      {
        ...shared(),
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['tests/components/**/*.test.ts', 'tests/components/**/*.test.tsx'],
        },
      },
    ],
  },
});
