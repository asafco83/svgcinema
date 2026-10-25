// Builds the standalone batch converter: tools/converter/dist/SVGcinema-Converter.html, one HTML
// file with the converter and the whole editor inside it (the editor works in a hidden frame). It is
// not part of the site or the deploy bundle: open the file from disk (Chrome or Edge for saving
// into a folder) or keep it anywhere you like.
//   npm run build:converter
import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..'),
  here = resolve(import.meta.dirname),
  tmp = mkdtempSync(join(tmpdir(), 'cin-editor-'));
// 1. the editor as one file (same settings as the site's build)
await build({
  root,
  configFile: join(root, 'vite.config.ts'),
  logLevel: 'warn',
  plugins: [viteSingleFile()],
  build: { outDir: tmp, emptyOutDir: true, sourcemap: false, copyPublicDir: false },
});
const editor = readFileSync(join(tmp, 'index.html'), 'utf8');
rmSync(tmp, { recursive: true, force: true });
// 2. the converter, with the editor inside
await build({
  root: here,
  configFile: false,
  base: './',
  logLevel: 'warn',
  plugins: [viteSingleFile()],
  // (escaped so the editor's own </script> tags cannot end the converter's inline script)
  define: { __EDITOR_HTML__: JSON.stringify(editor).replace(/<\//g, '<\\/') },
  build: {
    target: 'es2019',
    outDir: join(here, 'dist'),
    emptyOutDir: true,
    copyPublicDir: false,
    rollupOptions: { input: join(here, 'converter.html') },
  },
});
renameSync(join(here, 'dist', 'converter.html'), join(here, 'dist', 'SVGcinema-Converter.html'));
console.log('tools/converter/dist/SVGcinema-Converter.html');
