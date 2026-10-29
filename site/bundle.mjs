// SVGcinema — deploy bundle
// Puts the website and the editor build together, ready to upload to any static host:
//   deploy/index.html, deploy/<page>/index.html   the website (site/build.mjs writes them into site/)
//   deploy/img/         the editor captures the pages show (site/img/)
//   deploy/editor/      the editor (dist/ from `vite build`)
// Run `npm run build:deploy`, which builds both first. Usage on its own:
//   node site/bundle.mjs              # → deploy/
//   node site/bundle.mjs --out=/path  # → somewhere else
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find(a => a.startsWith('--out='));
const out = resolve(root, arg ? arg.slice('--out='.length) : 'deploy');
const site = join(root, 'site'),
  page = join(site, 'index.html'),
  dist = join(root, 'dist');
if (!existsSync(page)) throw new Error('site/index.html is missing: run node site/build.mjs');
// the inner pages: every folder of site/ with an index.html (features/, agent/, …)
const pages = readdirSync(site).filter(f => f !== 'src' && existsSync(join(site, f, 'index.html')));
if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ is missing: run npm run build');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(page, join(out, 'index.html'));
for (const p of pages) cpSync(join(site, p, 'index.html'), join(out, p, 'index.html'));
cpSync(join(site, 'img'), join(out, 'img'), { recursive: true });
// source maps would publish the full source: never ship them, even from an older dist/
cpSync(dist, join(out, 'editor'), { recursive: true, filter: src => !src.endsWith('.map') });
// …and the scripts' pointers to them go too (the GitHub Pages build keeps both, for debugging)
(function strip(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) strip(p);
    else if (/\.(js|css)$/.test(f))
      writeFileSync(p, readFileSync(p, 'utf8').replace(/\n?\/[/*]# sourceMappingURL=\S+?(?: \*\/)?\s*$/, '\n'));
  }
})(join(out, 'editor'));

// every local link in the pages must reach a file in the bundle (the thumbnail installers in
// editor/downloads/ come from site/fetch-downloads.sh): a broken one stops the build
const broken = [];
(function links(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) links(p);
    else if (f.endsWith('.html'))
      for (const m of readFileSync(p, 'utf8').matchAll(/\b(?:href|src)="([^"]+)"/g)) {
        const u = m[1].split('#')[0].split('?')[0];
        if (!u || /^([a-z]+:|\/\/)/i.test(m[1])) continue;
        const t = u.startsWith('/') ? join(out, u) : join(dirname(p), decodeURIComponent(u));
        if (!existsSync(t) || (statSync(t).isDirectory() && !existsSync(join(t, 'index.html'))))
          broken.push(`${p.slice(out.length + 1)} → ${m[1]}`);
      }
  }
})(out);
if (broken.length)
  throw new Error(
    'Broken links in the bundle (for the thumbnail installers, run sh site/fetch-downloads.sh first):\n  ' +
      broken.join('\n  '),
  );

let n = 0,
  bytes = 0;
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f),
      s = statSync(p);
    if (s.isDirectory()) walk(p);
    else {
      n++;
      bytes += s.size;
    }
  }
})(out);
console.log(
  `${out}: ${n} files, ${(bytes / 1048576).toFixed(1)} MB (the website: index.html, ${pages.join(', ')}, img/; editor/)`,
);
