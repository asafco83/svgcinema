import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

// Shown in Help › About: the version from package.json, the commit it was built from and when (an ISO time).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
// the external player's version (player/package.json): exports link to that version on jsDelivr
const playerPkg = JSON.parse(readFileSync(new URL('./player/package.json', import.meta.url), 'utf8'));
let build = '';
try {
  build = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch (_) {
  /* not a git checkout */
}

/** The service worker's list (public/sw.js): what to keep on install so the editor opens offline. The image
 *  encoders, help clips, downloads and source maps are left out (the encoders are kept once used). */
let outDir = '';
const precache = {
  name: 'svgcinema-precache',
  apply: 'build' as const,
  configResolved(c: { root: string; build: { outDir: string } }) {
    outDir = isAbsolute(c.build.outDir) ? c.build.outDir : join(c.root, c.build.outDir);
  },
  closeBundle() {
    const dist = outDir;
    let assets: string[] = [];
    try {
      assets = readdirSync(join(dist, 'assets'))
        .filter(f => /\.(js|css)$/.test(f))
        .map(f => 'assets/' + f);
    } catch (_) {
      return; // not the editor's build (the player, the converter)
    }
    const files = [
      'index.html',
      'manifest.webmanifest',
      'favicon.ico',
      'brand/icon-192.png',
      'brand/icon-512.png',
      'brand/svgcinema-logo-black.svg',
      'brand/svgcinema-logo-white.svg',
      ...assets,
    ];
    writeFileSync(
      join(dist, 'sw-precache.json'),
      JSON.stringify({ build: build + '-' + Date.now().toString(36), files }),
    );
  },
};

export default defineConfig({
  plugins: [precache],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __PLAYER_VERSION__: JSON.stringify(playerPkg.version),
    __APP_BUILD__: JSON.stringify(build),
    __APP_DATE__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    // ES2019 keeps the embedded runtime (CinEngine.toString()) free of bundler helpers
    target: 'es2019',
    // source maps stay on for debugging the GitHub Pages build; site/bundle.mjs leaves them out of the zip
    sourcemap: true,
  },
  // the image encoders (WebAssembly, in a worker) load their .wasm files by URL: Vite must not prebundle them
  optimizeDeps: { exclude: ['@jsquash/avif', '@jsquash/jxl', '@jsquash/webp'] },
  worker: { format: 'es' },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
