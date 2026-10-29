// SVGcinema — website build
// Builds every page of the website from site/src/ into self-contained HTML files (styles and script inlined;
// the editor captures in site/img/ are the only other files the pages load):
//   site/index.html, site/features/index.html, site/agent/index.html, site/import/index.html,
//   site/export/index.html, site/downloads/index.html, site/licence/index.html
// Usage:
//   node site/build.mjs                      # editor links point to editor/ next to the site's home page
//   node site/build.mjs --editor=https://…   # editor links point somewhere else
//   node site/build.mjs --out=/abs/dir       # write the pages somewhere else (img/ is not copied)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(join(here, p), 'utf8');
const arg = process.argv.find(a => a.startsWith('--editor='));
const editorArg = arg ? arg.slice('--editor='.length) : null;
const outArg = process.argv.find(a => a.startsWith('--out='));
const outDir = outArg ? outArg.slice('--out='.length) : '.';
const outRoot = isAbsolute(outDir) ? outDir : join(here, outDir);

// The logo comes from the brand file: the letters of "SVG", the film-strip squares (animated on load) and "cinema".
const brand = read('../public/brand/svgcinema-logo-white.svg');
const logoVB = (brand.match(/viewBox="([^"]+)"/) || [])[1];
if (!logoVB) throw new Error('brand logo: no viewBox');
// a film-strip square: a small "SVG"-coloured shape that sits entirely in the top band, above the letters
const isSquare = d => {
  const n = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number),
    xs = n.filter((_, i) => i % 2 === 0),
    ys = n.filter((_, i) => i % 2 === 1);
  return Math.max(...ys) < 5 && Math.max(...xs) - Math.min(...xs) < 4;
};
let perf = 0;
const logo = [...brand.matchAll(/<path d="([^"]+)" class="(cls-\d)"\/>/g)]
  .map(([, d, cls]) => {
    const isPerf = cls === 'cls-1' && isSquare(d);
    if (isPerf) return `<path class="lg-p" style="--i:${perf++}" d="${d}"/>`;
    return `<path class="${cls === 'cls-2' ? 'lg-a' : 'lg-b'}" d="${d}"/>`;
  })
  .join('');

// The pages name no other product: the player's compatibility alias and the snippet comment about it go
const hero = read('src/hero.svg')
  .trim()
  .replace(/\.player=s\.svgatorPlayer=/g, '.player=');
// the sizes the pages quote: the hero file as it is, and gzipped (always measured, never typed in)
const heroBytes = Buffer.from(read('src/hero.svg')),
  kb = n => (n / 1024).toFixed(1) + ' KB',
  heroKB = kb(heroBytes.length),
  heroGZ = kb(gzipSync(heroBytes, { level: 9 }).length);
const snips = JSON.parse(read('src/snippets.json'));
for (const k in snips) snips[k] = snips[k].replace(/[ \t]*\/\/ also \.svgatorPlayer/g, '');
const snippets = JSON.stringify(snips).replace(/<\//g, '<\\/');
const playerVersion = JSON.parse(read('../player/package.json')).version;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A capture's size, read from its WebP header, so the page reserves its space before it loads.
function webpSize(file) {
  const b = readFileSync(file);
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8L') {
    const v = b.readUInt32LE(21);
    return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1];
  }
  if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  throw new Error(`${file}: not a WebP the build can measure`);
}
// {{CAP:name|alt|class}}: a capture of the editor in the reader's theme. Both files are named in the page;
// the one for the other theme is hidden with CSS, and lazy loading leaves it unfetched.
function capture(spec, img) {
  const [name, alt = '', cls = ''] = spec.split('|');
  const tag = (file, c, a) => {
    const p = join(here, 'img', file + '.webp');
    if (!existsSync(p)) throw new Error(`site/img/${file}.webp is missing: run python3 site/captures.py`);
    const [w, h] = webpSize(p);
    return `<img class="cap ${c}${cls ? ' ' + cls : ''}" src="${img}${file}.webp" width="${w / 2}" height="${h / 2}" alt="${esc(a)}"${a ? '' : ' aria-hidden="true"'} loading="lazy" decoding="async">`;
  };
  return tag(name, 'cap-l', alt) + tag(name + '-dark', 'cap-d', '');
}
// {{SHOT:name|alt|class}}: one capture, the same in both themes (e.g. the dark agent panel on the dark band)
function shot(spec, img) {
  const [name, alt = '', cls = ''] = spec.split('|');
  const p = join(here, 'img', name + '.webp');
  if (!existsSync(p)) throw new Error(`site/img/${name}.webp is missing: run python3 site/captures.py`);
  const [w, h] = webpSize(p);
  return `<img class="cap${cls ? ' ' + cls : ''}" src="${img}${name}.webp" width="${w / 2}" height="${h / 2}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}

// {{ART:slug}}: only the animated picture of a demo card (the Features page puts its own words under it)
function specArt(slug) {
  const src = read(`src/specs/${slug}.html`);
  const a = src.indexOf('<div class="spec-art'),
    b = src.indexOf('<div class="spec-tx">');
  if (a < 0 || b < a) throw new Error(`src/specs/${slug}.html: no spec-art`);
  return src.slice(a, b).trim();
}

const css = read('src/site.css'),
  js = read('src/site.js'),
  layout = read('src/partials/layout.html'),
  header = read('src/partials/header.html'),
  footer = read('src/partials/footer.html');
const NAV = [
  ['features', 'Features', 'features/'],
  ['agent', 'Design agent', 'agent/'],
  ['import', 'Import', 'import/'],
  ['export', 'Export', 'export/'],
  ['downloads', 'Downloads', 'downloads/'],
];
// The licence as paragraphs: the file wraps its lines by hand; "- " lines are list items, "1. " starts a numbered one.
const licence = read('../LICENSE')
  .trim()
  .split(/\n\s*\n/)
  .map(par => {
    const items = [];
    for (const line of par.split('\n')) {
      if (!items.length || /^(- |\d+\. )/.test(line)) items.push(line.trim());
      else items[items.length - 1] += ' ' + line.trim();
    }
    const lead = items[0].startsWith('- ') ? '' : items.shift();
    let html = lead ? `<p>${esc(lead)}</p>` : '';
    if (items.length) html += `<ul>${items.map(i => `<li>${esc(i.replace(/^- /, ''))}</li>`).join('')}</ul>`;
    return html;
  })
  .join('\n');

const pages = readdirSync(join(here, 'src/pages')).filter(f => f.endsWith('.html'));
const written = [];
for (const f of pages) {
  let src = read('src/pages/' + f);
  const m = src.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\n?/);
  if (!m) throw new Error(`${f}: the page must start with its settings in a comment`);
  const meta = JSON.parse(m[1]);
  src = src.slice(m[0].length);
  const path = meta.path || '';
  const rootRel = path ? '../'.repeat(path.split('/').filter(Boolean).length) : '';
  const editor = editorArg || rootRel + 'editor/';
  const img = rootRel + 'img/';
  const nav = NAV.map(
    ([id, label, href]) => `<a href="${rootRel}${href}"${meta.nav === id ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('\n      ');
  let body = header + '<main id="top">\n' + src + '</main>\n' + footer;
  if (src.includes('id="codeEl"')) body += `<script id="snips" type="application/json">\n  ${snippets}\n</script>\n`;
  body += `<script>\n${js}</script>`;
  let html = layout
    .replace('{{BODY}}', () => body)
    .replace(/\{\{SPEC:([a-z-]+)\}\}/g, (_, s) => read(`src/specs/${s}.html`).trim())
    .replace(/\{\{ART:([a-z-]+)\}\}/g, (_, s) => specArt(s))
    .replace(/\{\{CAP:([^}]+)\}\}/g, (_, s) => capture(s, img))
    .replace(/\{\{SHOT:([^}]+)\}\}/g, (_, s) => shot(s, img))
    .replaceAll('{{TITLE}}', esc(meta.title))
    .replaceAll('{{DESCRIPTION}}', esc(meta.description))
    .replaceAll('{{CSS}}', () => css)
    .replaceAll('{{NAV}}', () => nav)
    .replaceAll('{{HOME}}', () => rootRel || './')
    .replaceAll('{{LOGO}}', () => logo)
    .replaceAll('{{LOGO_VB}}', () => logoVB)
    .replaceAll('{{HERO_SVG}}', () => hero)
    .replaceAll('{{HERO_KB}}', () => heroKB)
    .replaceAll('{{HERO_GZ}}', () => heroGZ)
    .replaceAll('{{PLAYER_VERSION}}', () => playerVersion)
    .replaceAll('{{LICENCE}}', () => licence)
    .replaceAll('{{ROOT}}', () => rootRel)
    .replaceAll('{{IMG}}', () => img)
    .replaceAll('{{DL}}', () => editor + 'downloads/')
    .replaceAll('{{EDITOR_URL}}', editor);
  const left = html.match(/\{\{[A-Z_:]+[^}]*\}\}/);
  if (left) throw new Error(`${f}: unknown placeholder ${left[0]}`);
  const dir = join(outRoot, path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
  written.push(`${path || '(home)'} ${(html.length / 1024).toFixed(0)} KB`);
}
console.log(`site: ${written.join(', ')}; editor links → ${editorArg || 'editor/'}`);
