import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Shared iSteel files (outside this build) that every app page loads: live stamp + update check, ads, side menu style,
// and the ⚙ menu (view-mode.js). Added after the build so a rebuild never drops them. Bump V when the app changes.
const V = '20261125e';
const shared = () => ({
  name: 'isteel-shared',
  enforce: 'post' as const,
  transformIndexHtml(html: string) {
    return html
      .replace('<script src="config.js"></script>', '<script src="config.js"></script>\n  <script src="../live.js?v=20261113b"></script>\n  <script src="../ads.js?v=20261031a" data-app="transport"></script>')
      .replace(/<link rel="stylesheet" crossorigin href="\.\/delivery\.css">/, '<link rel="stylesheet" crossorigin href="./delivery.css?v=' + V + '">\n  <link rel="stylesheet" href="../ads.css?v=20261031a">\n  <link rel="stylesheet" href="../sidenav.css?v=20261105c">\n  <script src="../view-mode.js?v=20261119a"></script>')
      .replace('src="./delivery.js"', 'src="./delivery.js?v=' + V + '"');
  },
});

// Builds into the live site folder: web/delivery/ (Cloudflare Pages serves web/ as is, no build step there).
export default defineConfig({
  plugins: [react(), shared()],
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
