// SVGcinema — the website's help pages (Help & tutorials)
// Written from src/help/content.json, the same file the editor's Help panel reads, so the two never differ:
//   help/            the hub: search, Start here, every topic by group
//   help/<topic>/    a topic: what it does, "Do it in the editor: guided tour" (the practice editor in a
//                    lightbox: site.js), the steps with their clips, keys, related topics
// Only topics marked `ready` get a page. The step clips and the "What you'll make" SVG are the editor's own
// files (public/help/, recorded by site/captures.py), loaded from the editor's folder: {{HCLIP:…}} and
// {{EDITOR_URL}}help/….

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** content.json's step text: HTML with {◆} for a keyframe diamond */
const rich = h => String(h).replace(/\{◆\}/g, '<i class="hdm" role="img" aria-label="keyframe diamond"></i>');
const plain = h =>
  String(h)
    .replace(/<[^>]+>/g, '')
    .replace(/\{◆\}/g, '◆');
/** "Shift P" → two keys; in "Alt + drag" the + and a word for the pointer (drag, click, scroll) are plain text */
const keys = k => {
  const ps = k.split(' ');
  return ps
    .map(p => (ps.length > 1 && (p === '+' || /^[a-z]{2,}$/.test(p)) ? esc(p) : `<kbd>${esc(p)}</kbd>`))
    .join(' ');
};
const PLAY =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.8v10.4a.6.6 0 00.9.5l8.2-5.2a.6.6 0 000-1L4.9 2.3a.6.6 0 00-.9.5z"/></svg>';
const SEARCH =
  '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';

export function helpPages(content) {
  const groups = content.groups,
    ready = content.topics.filter(t => t.ready),
    byId = id => ready.find(t => t.id === id),
    gOf = t => groups.find(g => g.id === t.group),
    used = groups.filter(g => ready.some(t => t.group === g.id)),
    meta = t => (t.tour ? `${t.steps.length} steps · about ${t.minutes || 3} minutes` : `${t.steps.length} steps`);
  const tourBtn = (t, label, cls = 'btn-pri') =>
    `<a class="btn ${cls}" href="{{EDITOR_URL}}?tour=${t.id}" data-tour="${t.id}" target="_blank" rel="noopener">${PLAY}${label}</a>`;
  const row = t =>
    `<a class="hrow" href="{{ROOT}}help/${t.id}/" data-find="${esc(
      [t.title, t.intro, ...t.steps.map(s => s.title + ' ' + plain(s.text))].join(' ').toLowerCase(),
    )}"><span>${esc(t.title)}</span>${t.tour ? '<span class="htag">Guided tour</span>' : ''}<span class="hmin">${
      t.minutes ? t.minutes + ' min' : ''
    }</span></a>`;
  const pages = [];

  // ---------- the hub ----------
  const starts = ready.filter(t => t.start),
    pending = content.topics.some(t => !t.ready);
  const hub = `<section class="phead mat">
  <div class="wrap">
    <p class="crumb"><a href="{{HOME}}">Home</a><span>/</span>Help</p>
    <div class="phead-row">
      <div>
        <div class="tc">HELP &amp; TUTORIALS</div>
        <h1>Learn it by<br />doing it.</h1>
      </div>
      <p>
        Every tool and feature, step by step. Topics marked <b>Guided tour</b> also run inside the editor: it opens a
        practice scene, points at each control and waits while you do it. The same pages are in the editor too, under
        ☰ › Help.
      </p>
    </div>
    <label class="hsearch">${SEARCH}<input id="helpQ" type="search" placeholder="Search help: keyframes, easing, play…" aria-label="Search help" autocomplete="off" /><kbd>/</kbd></label>
    <div class="pchips">${used.map(g => `<a href="#g-${g.id}">${esc(g.title)}</a>`).join('')}</div>
  </div>
</section>
<section class="sec hsec" id="start">
  <div class="wrap">
    <div class="tc">START HERE</div>
    <div class="hcards">${starts
      .map(
        t => `<article class="card hcard">
        <a class="hcard-vis" href="{{ROOT}}help/${t.id}/" tabindex="-1" aria-hidden="true">{{HCLIP:${t.id}-${t.steps.length}||hclip}}</a>
        <p class="hcard-k"><span class="htag">Guided tour</span><span class="hmin">${t.minutes || 3} min · ${t.steps.length} steps</span></p>
        <h3><a href="{{ROOT}}help/${t.id}/">${esc(t.title)}</a></h3>
        <p>${esc(plain(t.intro))}</p>
        ${tourBtn(t, 'Start in the editor', 'btn-ghost btn-sm')}
      </article>`,
      )
      .join('\n')}</div>
  </div>
</section>
<section class="sec hsec" id="all">
  <div class="wrap">
    <div class="tc">EVERY TOOL AND FEATURE</div>
    <div class="hgroups">${used
      .map(
        g => `<section class="card hgroup" id="g-${g.id}"><h3>${esc(g.title)}</h3><p>${esc(g.sub)}</p>
        <div class="hlist">${ready
          .filter(t => t.group === g.id)
          .map(row)
          .join('')}</div></section>`,
      )
      .join('\n')}</div>
    <p class="hnone" id="helpNone" hidden>Nothing found. Try another word, or browse the topics above.</p>
    ${
      pending
        ? '<p class="hsoon">More topics are on the way. Until then, the ⓘ beside a setting in the editor explains it, and F1 lists every key.</p>'
        : ''
    }
  </div>
</section>
<section class="band hband">
  <div class="wrap hband-in">
    <div>
      <h2>In the editor too.</h2>
      <p>
        ☰ › Help › Help &amp; tutorials (<kbd>Shift</kbd> <kbd>F1</kbd>) opens these pages in a panel beside the inspector.
        They come with the editor, so they work offline, and a guided tour opens beside the panel without touching
        your project.
      </p>
    </div>
    {{CLIP:help-panel|The Help panel in the editor: a topic with its steps, and a guided tour beside it|hband-cap}}
  </div>
</section>
`;
  pages.push({
    meta: {
      path: 'help/',
      nav: 'help',
      title: 'Help & tutorials · SVGcinema',
      description:
        'Learn SVGcinema step by step: every topic explained, with clips, and guided tours that run inside the editor in a practice scene.',
    },
    src: hub,
  });

  // ---------- a topic ----------
  ready.forEach((t, k) => {
    const g = gOf(t),
      prev = ready[k - 1],
      next = ready[k + 1],
      rel = (t.related || []).map(byId).filter(Boolean);
    const side = used
      .map(gr => {
        const ts = ready.filter(x => x.group === gr.id),
          open = gr.id === t.group;
        return `<details class="hs-g"${open ? ' open' : ''}><summary>${esc(gr.title)}<em>${ts.length}</em></summary>${ts
          .map(
            x =>
              `<a href="{{ROOT}}help/${x.id}/"${x.id === t.id ? ' aria-current="page"' : ''}>${esc(x.title)}${
                x.tour ? '<i class="htt" title="Guided tour"></i>' : ''
              }</a>`,
          )
          .join('')}</details>`;
      })
      .join('');
    const src = `<div class="mat hcrumb"><div class="wrap"><p class="crumb"><a href="{{HOME}}">Home</a><span>/</span><a href="{{ROOT}}help/">Help</a><span>/</span>${esc(
      g.title,
    )}<span>/</span>${esc(t.title)}</p></div></div>
<div class="wrap htopic">
  <aside class="hside" aria-label="Help topics"><div class="hside-in">
    <a class="hs-all" href="{{ROOT}}help/">← All help</a>
    ${side}
  </div></aside>
  <article class="hart">
    <div class="tc">${esc(g.title.toUpperCase())}</div>
    <h1>${esc(t.title)}</h1>
    <p class="hlead">${rich(t.intro)}</p>
    ${
      t.goal
        ? `<div class="card hgoal"><img src="{{EDITOR_URL}}help/${t.id}.svg" width="640" height="400" alt="${esc(
            t.goal,
          )}" /><div><div class="tc">WHAT YOU’LL MAKE</div><p>${esc(t.goal)} This one is the real exported SVG, playing.</p></div></div>`
        : ''
    }
    ${
      t.tour
        ? `<div class="htour">${tourBtn(t, 'Do it in the editor: guided tour')}<span class="hmeta">${meta(
            t,
          )} · opens a practice scene</span></div>`
        : ''
    }
    <h2 id="steps" class="hh2">Step by step</h2>
    <ol class="hsteps">${t.steps
      .map(
        (s, i) =>
          `<li><div><h3>${esc(s.title)}</h3><p>${rich(s.text)}</p>${
            s.clip === false ? '' : `{{HCLIP:${t.id}-${i + 1}|${esc(s.title)}|hstep-clip}}`
          }</div></li>`,
      )
      .join('\n')}</ol>
    ${t.note ? `<div class="hnote"><b>Good to know.</b> ${rich(t.note)}</div>` : ''}
    ${
      t.keys && t.keys.length
        ? `<h2 id="keys" class="hh2">Keys</h2><table class="hkeys">${t.keys
            .map(([k, w]) => `<tr><td>${keys(k)}</td><td>${esc(w)}</td></tr>`)
            .join('')}</table>`
        : ''
    }
    <nav class="hpn" aria-label="Previous and next topic">${
      prev
        ? `<a class="card" href="{{ROOT}}help/${prev.id}/"><span>← Previous</span><b>${esc(prev.title)}</b></a>`
        : '<span></span>'
    }${next ? `<a class="card hpn-n" href="{{ROOT}}help/${next.id}/"><span>Next →</span><b>${esc(next.title)}</b></a>` : ''}</nav>
  </article>
  <nav class="htoc" aria-label="On this page">
    <p>ON THIS PAGE</p><a href="#steps">Step by step</a>${t.keys && t.keys.length ? '<a href="#keys">Keys</a>' : ''}
    ${rel.length ? `<p>RELATED</p>${rel.map(r => `<a href="{{ROOT}}help/${r.id}/">${esc(r.title)}</a>`).join('')}` : ''}
    <p>IN THE EDITOR</p><span>☰ › Help › ${esc(t.title)}</span>
  </nav>
</div>
`;
    pages.push({
      meta: {
        path: `help/${t.id}/`,
        nav: 'help',
        title: `${t.title} · Help · SVGcinema`,
        description: plain(t.intro),
      },
      src,
    });
  });
  return pages;
}
