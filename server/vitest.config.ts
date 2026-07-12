import { defineConfig } from 'vitest/config';

// Test engine thuần (không cần DB): các unit test bám UAT ở §10 chạy trên logic pure.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    clearMocks: true,
  },
});
