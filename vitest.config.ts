import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      thresholds: {
        global: {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
      },
      exclude: [
        'node_modules/**',
        'packages/**/dist/**',
        'packages/**/tests/**',
        'packages/**/coverage/**',
        'coverage/**',
        '**/*.d.ts',
        '**/*.config.ts',
        '**/src/index.ts',
        '**/src/types/**',
      ],
    },
    setupFiles: [],
    sequence: {
      concurrent: false,
      shuffle: false,
    },
    testTimeout: 30000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@voice-agent-kit/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@voice-agent-kit/stt': resolve(__dirname, 'packages/stt/src/index.ts'),
      '@voice-agent-kit/tts': resolve(__dirname, 'packages/tts/src/index.ts'),
      '@voice-agent-kit/telephony': resolve(__dirname, 'packages/telephony/src/index.ts'),
      '@voice-agent-kit/mcp-client': resolve(__dirname, 'packages/mcp-client/src/index.ts'),
    },
  },
});
