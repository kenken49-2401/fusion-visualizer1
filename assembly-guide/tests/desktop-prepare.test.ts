import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
async function fixture(helper?: string) {
    const directory = await mkdtemp(join(tmpdir(), 'guide-desktop-prepare-'));
    const root = join(directory, 'assembly-guide');
    await mkdir(join(root, 'public'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<!doctype html><p>Guide fallback</p>');
    if (helper !== undefined) {
        await mkdir(join(directory, 'tools'));
        await writeFile(join(directory, 'tools/prepare-desktop.mjs'), helper);
    }
    return { directory, root };
}
async function serveAndFetch(root: string, path: string) {
    // Use native Node imports as the Vite CLI does. Vitest's module runner intercepts
    // dynamic file: imports of the temporary standalone helper outside this checkout.
    const script = `
        import { createServer } from 'vite';
        import { guideAdmin } from ${JSON.stringify(pathToFileURL(resolve('admin-server.ts')).href)};
        let server;
        try {
            server = await createServer({ root: process.argv[1], configFile: false, logLevel: 'silent', plugins: [guideAdmin()], server: { host: '127.0.0.1', port: 0, watch: null } });
            await server.listen();
            const { port } = server.httpServer.address();
            const response = await fetch('http://127.0.0.1:' + port + process.argv[2]);
            console.log(JSON.stringify({ status: response.status, type: response.headers.get('content-type'), text: await response.text() }));
        } finally { await server?.close(); }
    `;
    const { stdout } = await exec(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script, root, path], { timeout: 15000 });
    return JSON.parse(stdout.trim()) as { status: number; type: string; text: string };
}

describe('desktop data preparation before Vite public-file discovery', () => {
    it('serves newly migrated public files on the first launch rather than the HTML fallback', async () => {
        const { directory, root } = await fixture(`
            import { mkdir, writeFile } from 'node:fs/promises';
            import { join } from 'node:path';
            export async function prepareDesktopEditor(guideRoot) {
                await mkdir(join(guideRoot, 'public/models'), { recursive: true });
                await writeFile(join(guideRoot, 'public/models/new-desk.json'), JSON.stringify({ model: 'models/new-desk.3mf', migrated: true }));
            }
        `);
        try {
            const response = await serveAndFetch(root, '/models/new-desk.json');
            expect(response.status).toBe(200);
            expect(response.type).toContain('application/json');
            expect(JSON.parse(response.text)).toEqual({ model: 'models/new-desk.3mf', migrated: true });
        } finally { await rm(directory, { recursive: true, force: true }); }
    });

    it('keeps a standalone guide folder usable when the parent helper is absent', async () => {
        const { directory, root } = await fixture();
        try {
            await writeFile(join(root, 'public/existing.json'), '{"standalone":true}');
            const response = await serveAndFetch(root, '/existing.json');
            expect(JSON.parse(response.text)).toEqual({ standalone: true });
        } finally { await rm(directory, { recursive: true, force: true }); }
    });

    it('fails before server creation if desktop recovery says startup is unsafe', async () => {
        const { directory, root } = await fixture('export async function prepareDesktopEditor() { throw new Error("Recovery required"); }');
        try { await expect(serveAndFetch(root, '/')).rejects.toThrow('Recovery required'); }
        finally { await rm(directory, { recursive: true, force: true }); }
    });
});
