import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, rootDir, ''));
  return {
    resolve: {
      alias: { '@': path.resolve(rootDir, 'src') },
    },
    test: {
      globals: true,
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  };
});
