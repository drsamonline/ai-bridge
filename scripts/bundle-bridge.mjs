#!/usr/bin/env node
/**
 * Bundles the bridge into ONE file, the same way the extension is bundled.
 *
 * Why: the bridge was compiled with tsc, so `bridge/dist/main.js` does
 * `require('@ai-bridge/shared')` and `require('ws')` at runtime. Inside a .vsix
 * there is no node_modules and no workspace, so the packaged extension installed,
 * activated, and then failed with "bridge entry not found" — the entry was never
 * shipped at all, and would not have run if it had been.
 *
 * `playwright-core` stays external on purpose: it resolves its own driver files
 * from disk at runtime, so bundling it breaks it. It is shipped alongside instead,
 * which costs about 8 MB.
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['bridge/src/main.ts'],
  outfile: 'bridge/dist/bridge.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  external: ['playwright-core'],
  logLevel: 'info',
});
