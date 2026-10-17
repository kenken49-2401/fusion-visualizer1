import { defineConfig } from 'vite';
import { guideAdmin } from './admin-server.ts';
export default defineConfig(({ mode }) => ({
    base: process.env.BASE_PATH || '/',
    define: { __GUIDE_ADMIN__: JSON.stringify(mode === 'admin') },
    plugins: mode === 'admin' ? [guideAdmin()] : [],
    server: { host: '127.0.0.1', port: 5273, strictPort: true, watch: { ignored: ['**/public/guides/**', '**/.local/**', '**/*.pending'] } },
    preview: { host: '127.0.0.1', port: 4273, strictPort: true }, build: { target: 'es2022', sourcemap: false },
}));
