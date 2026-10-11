import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds into the live site folder: web/delivery/ (Cloudflare Pages serves web/ as is, no build step there).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../web/delivery',
    emptyOutDir: true,
    assetsDir: '.',
    target: 'es2019',
    rollupOptions: {
      input: 'index.html',
      output: { entryFileNames: 'delivery.js', chunkFileNames: 'delivery-[name]-[hash].js', assetFileNames: 'delivery[extname]' },
    },
  },
  server: { port: 5174 },
});
