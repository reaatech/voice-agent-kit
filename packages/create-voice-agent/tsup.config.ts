import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  tsconfig: './tsconfig.json',
  banner: {
    js: '#!/usr/bin/env node',
  },
});
