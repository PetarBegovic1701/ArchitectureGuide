import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `pnpm dev` against a running `archguide serve` (default port 4317): the API and the
// WebSocket go to it, so serve mode works with hot reload. Open /?t=<token>.
const serve = process.env.ARCHGUIDE_SERVE ?? 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5179,
    strictPort: true,
    proxy: { '/api': serve, '/ws': { target: serve, ws: true } },
  },
  preview: { port: 5179, strictPort: true },
});
