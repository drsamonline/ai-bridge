/**
 * Bundles the extension into ONE file so the .vsix is self-contained.
 *
 * Without this, `extension/dist` resolves `@ai-bridge/shared` (and its `ws`
 * dependency) from `node_modules`, which is not shipped inside a vsix — the
 * extension would install and then fail to activate.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  minify: false,
  // `vscode` is provided by the host; `node-llama-cpp` is an optional peer that
  // must stay a runtime require so T1 can report itself unavailable.
  external: ['vscode', 'node-llama-cpp'],
  logLevel: 'info',
});
