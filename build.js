import * as esbuild from 'esbuild';
import { chmod } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get __dirname equivalent in ES modules
const __dirname = dirname(fileURLToPath(import.meta.url));

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
    format: 'esm',
    banner: {
      js: '#!/usr/bin/env node\nimport { createRequire } from "module"; const require = createRequire(import.meta.url);',
    },
  });

  await chmod('build/index.js', 0o755);

  // Build MCP server
  await esbuild.build({
    entryPoints: ['src/server.js'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'build/server.cjs',
    minify: true,
    sourcemap: true,
    external: [],
    format: 'cjs',
    banner: {
      js: '#!/usr/bin/env node',
    },
  });
  await chmod('build/server.cjs', 0o755);

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
