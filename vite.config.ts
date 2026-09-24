import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@chain/casino-sdk/guest': path.resolve('/tmp/casino-sdk/casino-sdk/src/guest.ts'),
      '@chain/casino-sdk': path.resolve('/tmp/casino-sdk/casino-sdk/src/index.ts'),
      'penpal': path.resolve(__dirname, './node_modules/penpal'),
    },
  },
  server: { port: 3300, cors: true },
  preview: { port: 3300, cors: true },
});
