import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Shown in Help › About: the version from package.json, the commit it was built from and the date.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
let build = '';
try {
  build = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch (_) {
  /* not a git checkout */
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(build),
    __APP_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: {
    // ES2019 keeps the embedded runtime (CinEngine.toString()) free of bundler helpers
    target: 'es2019',
    sourcemap: true,
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
