import { defineConfig } from 'vite';
import { localAdmin } from './admin-server.ts';

export default defineConfig(({ mode }) => ({
  base: process.env.BASE_PATH || '/',
  plugins: mode === 'admin' ? [localAdmin()] : [],
  define: {
    __LOCAL_ADMIN__: JSON.stringify(mode === 'admin'),
  },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    // Saving local colors should update the preview without an automatic page reload.
    watch: { ignored: ['**/public/viewer.json', '**/public/models/**', '**/*.pending', '**/.local/**'] },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022', sourcemap: false },
}));
