import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev cổng 5173, proxy /api -> backend Express (cổng 4000), giữ cookie phiên.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        // Giữ nguyên cookie httpOnly khi proxy (không rewrite domain).
      },
    },
  },
});
