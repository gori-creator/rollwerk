import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-ignore – plain JS module shared with the production server
import { handleApi } from './server/api.mjs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'rollwerk-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url && req.url.startsWith('/api/')) {
            const handled = await handleApi(req, res);
            if (handled) return;
          }
          next();
        });
      },
    },
  ],
  server: { host: 'localhost', port: 5174, strictPort: true },
  test: { environment: 'jsdom' },
});
