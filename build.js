import * as esbuild from 'esbuild';
import {chmod} from 'fs/promises';

async function build() {
    // Build WebSocket server
    await esbuild.build({
        entryPoints: ['src/websocket-server.js'],
        bundle: true,
        platform: 'node',
        target: 'node20',
        outfile: 'build/index.js',
        minify: true,
        sourcemap: true,
        external: ['events'],
        format: 'cjs',
        banner: {
            js: '#!/usr/bin/env node\nimport { createRequire } from "module"; const require = createRequire(import.meta.url);',
        },
    });

    await chmod('build/index.js', 0o755);

    // Build Widget
    await esbuild.build({
        entryPoints: ['src/webmcp.js'],
        bundle: true,
        outfile: 'build/webmcp.js',
        minify: true,
        target: 'es2015',
        sourcemap: true,
    });

    console.log('Build completed successfully!');
}

build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
});
