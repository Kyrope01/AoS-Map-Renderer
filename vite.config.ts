import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

/**
 * The dev/build entry is app.html (it loads /src/main.tsx). The root index.html
 * is the prebuilt standalone bundle produced by `npm run build`, so in dev we
 * redirect "/" to the source entry instead of serving the stale build.
 */
function devEntryRedirect(): Plugin {
  return {
    name: 'dev-entry-redirect',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url === '/' || url === '/index.html' || url.startsWith('/index.html?')) {
          res.statusCode = 302;
          res.setHeader('Location', url.replace(/^\/(index\.html)?/, '/app.html'));
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({command}) => {
  return {
    // Relative asset URLs so the built page works from any path (GitHub Pages
    // project sites live under /AoS-Map-Renderer/). Dev serves from "/".
    base: command === 'build' ? './' : '/',
    plugins: [react(), tailwindcss(), devEntryRedirect()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: path.resolve(import.meta.dirname, 'app.html'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Allow the Arena live-preview host to load the dev server.
      allowedHosts: ['.e2b.app'],
    },
  };
});
