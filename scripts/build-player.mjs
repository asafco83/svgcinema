// Builds the external player (src/runtime/player.ts) into one minified script:
// - player/cin-player.min.js: the npm package's file (svgcinema-player, published by
//   .github/workflows/player.yml), with the package's version inside;
// - dist/downloads/ (when the editor has been built): cin-player.min.js (the latest) and
//   cin-player-<version>.min.js for self-hosting, and svgcinema-skill.zip (the Claude skill, the same zip the
//   agent panel makes), next to the thumbnail installers, with an index page.
import { build } from 'esbuild';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..'),
  pkg = JSON.parse(readFileSync(join(root, 'player/package.json'), 'utf8')),
  out = join(root, 'player/cin-player.min.js');
await build({
  entryPoints: [join(root, 'src/runtime/player.ts')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2019',
  legalComments: 'none',
  banner: {
    js: `/*! SVGcinema player ${pkg.version}. Proprietary, see the LICENSE file of the svgcinema-player package. */`,
  },
  define: { __PLAYER_VERSION__: JSON.stringify(pkg.version) },
  outfile: out,
});
copyFileSync(join(root, 'LICENSE'), join(root, 'player/LICENSE'));
const size = statSync(out).size;
console.log(`player/cin-player.min.js ${pkg.version} ${(size / 1024).toFixed(1)} KB`);

const dist = join(root, 'dist');
if (existsSync(join(dist, 'index.html'))) {
  const dl = join(dist, 'downloads');
  mkdirSync(dl, { recursive: true });
  copyFileSync(out, join(dl, 'cin-player.min.js'));
  copyFileSync(out, join(dl, `cin-player-${pkg.version}.min.js`));
  // the Claude skill as a static file, for the website's links: svgcinema/SKILL.md from src/agent/skill.ts
  const skillJs = await build({
    entryPoints: [join(root, 'src/agent/skill.ts')],
    bundle: true,
    format: 'esm',
    write: false,
  });
  const { SKILL_MD } = await import(
    'data:text/javascript;base64,' + Buffer.from(skillJs.outputFiles[0].text).toString('base64')
  );
  const tmp = mkdtempSync(join(tmpdir(), 'svgcinema-skill-'));
  mkdirSync(join(tmp, 'svgcinema'));
  writeFileSync(join(tmp, 'svgcinema/SKILL.md'), SKILL_MD);
  rmSync(join(dl, 'svgcinema-skill.zip'), { force: true });
  execFileSync('zip', ['-9', '-q', '-X', '-r', join(dl, 'svgcinema-skill.zip'), 'svgcinema'], { cwd: tmp });
  rmSync(tmp, { recursive: true, force: true });
  // the Windows installer is offered zipped (many web hosts refuse to serve .exe files); the
  // thumbnails release has the .zip, and an older .exe found here is zipped now
  const exe = 'SVGcinema-Thumbnails-Setup.exe';
  if (existsSync(join(dl, exe))) {
    execFileSync('zip', ['-9', '-q', '-j', join(dl, 'SVGcinema-Thumbnails-Setup.zip'), join(dl, exe)]);
    rmSync(join(dl, exe));
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const kb = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const what = {
    'SVGcinema-Thumbnails-Setup.zip':
      'Thumbnails in Windows File Explorer (Windows 10 and 11): unzip, then run the installer',
    'svgcinema-thumbnails.deb': 'Thumbnails in Linux file managers (.deb package)',
    'svgcinema-thumbnails-linux.tar.gz': 'Thumbnails in Linux file managers (with install.sh)',
    'cin-player.min.js': `The external player, latest (${pkg.version})`,
    'svgcinema-skill.zip': 'The Claude skill: add it to Claude and it knows how to work in SVGcinema',
  };
  const files = readdirSync(dl)
    .filter(f => f !== 'index.html')
    .sort((a, b) => (what[b] ? 1 : 0) - (what[a] ? 1 : 0) || a.localeCompare(b));
  const rows = files
    .map(f => {
      const d = what[f] || (/^cin-player-.*\.min\.js$/.test(f) ? 'The external player, this version' : '');
      return `<li><a href="${esc(f)}" download>${esc(f)}</a><span>${esc(d)}</span><em>${kb(statSync(join(dl, f)).size)}</em></li>`;
    })
    .join('\n');
  writeFileSync(
    join(dl, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SVGcinema downloads</title>
<style>:root{--bg:#eef0f4;--panel:#fbfbfd;--line:#e4e7ee;--fg:#161a25;--muted:#5f6779;--accent:#2c47d8;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0c0e12;--panel:#14171e;--line:#262a35;--fg:#e8eaf0;--muted:#959cae;--accent:#a3b2ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;padding:48px 16px}
main{max-width:760px;margin:0 auto}h1{font:italic 400 34px/1.1 Georgia,serif;margin:0 0 8px}p{color:var(--muted);margin:0 0 24px}
ul{list-style:none;margin:0;padding:0;background:var(--panel);border:1px solid var(--line);border-radius:12px}
li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 16px;padding:14px 18px;border-top:1px solid var(--line)}li:first-child{border-top:0}
a{color:var(--accent);font-weight:600;overflow-wrap:anywhere}span{color:var(--muted);font-size:13.5px;grid-column:1}em{font-style:normal;color:var(--muted);font-size:13px;grid-row:1/3;grid-column:2;align-self:center}</style></head>
<body><main><h1>SVGcinema downloads</h1><p>Thumbnail add-ons for your file manager, and the external player for self-hosting.</p><ul>
${rows}
</ul></main></body></html>
`,
  );
  console.log(`dist/downloads: ${files.join(', ')}`);
}
