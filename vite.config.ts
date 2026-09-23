import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@chain/casino-sdk/guest': path.resolve(__dirname, './src/casino-sdk/guest.ts'),
      '@chain/casino-sdk': path.resolve(__dirname, './src/casino-sdk/index.ts'),
    },
  },
  server: { port: 3300, cors: true },
  preview: { port: 3300, cors: true },
});
