import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/domain/**/*.{ts,tsx}'],
      exclude: ['src/domain/__tests__/**', 'src/**/index.ts']
    }
  }
});
