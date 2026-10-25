// SVGcinema — export/snippets
import { $, clamp, r3 } from '../core/constants';
import { save } from '../core/history';
import { doc } from '../core/state';
import { syncExportUI } from './dialog';
import { fileName, slug, updateExport } from './images';
import { outDims } from './size';
import { PLAYER_VERSION } from './build';
import { toast } from '../io/open';

export const FW_NOTES: Record<string, string> = {
  html: 'Put the .svg file next to your page. <code>&lt;object&gt;</code> keeps the player working. Pasting the SVG code straight into your HTML works too, but inserting it with <code>innerHTML</code> does not run its script.',
  react:
    'Put the .svg in your public folder. React does not run scripts inside markup set with <code>dangerouslySetInnerHTML</code>, so use <code>&lt;object&gt;</code>.',
  next: 'Put the .svg in <code>public/</code>. The component needs <code>"use client"</code> because it talks to the player in the browser.',
  vue: 'Put the .svg in <code>public/</code> (Vite or Vue CLI).',
  angular: 'Put the .svg in <code>src/assets/</code> (or <code>public/</code> on Angular 17+).',
  svelte: 'Put the .svg in <code>static/</code> (SvelteKit) or <code>public/</code>.',
  api: 'Every method returns the player, so calls can be chained. The player is also available as <code>cinPlayer</code>.',
};
export function snippet(fw: string): string {
  const ex = doc.ex,
    css = ex.mode === 'css',
    // the downloaded file's name, kept in any language; characters that break a URL are escaped
    file = (fileName(doc.name) + '.svg').replace(/[ #%'()&]/g, encodeURIComponent),
    pre =
      (String(ex.prefix || 'cin')
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .replace(/^[^a-z]+/, '') || 'cin') + '-',
    id = pre + 'svg';
  const label = doc.name.replace(/"/g, ''),
    comp = (slug(doc.name).replace(/(^|-)(\w)/g, (m, a, b) => b.toUpperCase()) || 'Animation').replace(/^\d/, 'A$&');
  const [DW, DH] = outDims(),
    ratio = `width="${DW}" height="${DH}"`;
  if (css && fw !== 'api') {
    const tag = (p: string) => `<img src="${p}${file}" alt="${label}" ${ratio} />`;
    return (
      {
        html: `<!-- CSS-only export: works as a normal image -->\n${tag('')}\n\n<!-- or as a background -->\n<div style="background:url(${file}) center/contain no-repeat;aspect-ratio:${DW}/${DH}"></div>`,
        react: `export default function ${comp}() {\n  return ${tag('/')};\n}`,
        next: `import Image from "next/image";\n\nexport default function ${comp}() {\n  // unoptimized keeps the SVG animation intact\n  return <Image src="/${file}" alt="${label}" width={${DW}} height={${DH}} unoptimized />;\n}`,
        vue: `<template>\n  ${tag('/')}\n</template>`,
        angular: `<!-- ${comp.toLowerCase()}.component.html -->\n${tag('assets/')}`,
        svelte: tag('/'),
      } as Record<string, string>
    )[fw];
  }
  const use = `player.ready((p) => {\n      p.on('end', () => console.log('finished'));\n      // p.play(); p.pause(); p.reverse(); p.seek(50); p.set('speed', 2);\n    });`;
  // Player › External: inline SVGs share one player, the page's own copy when it loads one
  if (fw === 'html' && ex.player === 'external')
    return `<!-- Optional: your own copy of the player.\n     Without it, the SVG loads it from jsDelivr. -->\n<script src="YOUR-ADDRESS/cin-player.min.js"><\/script>\n\n<!-- The SVG code (Copy SVG code), pasted into the page -->\n<svg id="${id}" …>…</svg>\n\n<script>\n  const svg = document.getElementById('${id}');\n  const start = (player) => {\n    ${use.replace(/\n {4}/g, '\n  ')}\n  };\n  svg.player ? start(svg.player) : svg.addEventListener('cinready', (e) => start(e.detail));\n<\/script>`;
  if (fw === 'html')
    return `<object id="${pre}anim" type="image/svg+xml" data="${file}" aria-label="${label}" style="width:100%;max-width:${DW}px"></object>\n\n<script>\n  document.getElementById('${pre}anim').addEventListener('load', (e) => {\n    const player = e.target.contentDocument.getElementById('${id}').player;\n    ${use}\n  });\n<\/script>`;
  if (fw === 'react' || fw === 'next')
    return `${fw === 'next' ? '"use client";\n\n' : ''}import { useEffect, useRef } from "react";\n\nexport default function ${comp}({ onReady }) {\n  const ref = useRef(null);\n\n  useEffect(() => {\n    const el = ref.current;\n    const handleLoad = () => {\n      const player = el.contentDocument?.getElementById("${id}")?.player;\n      if (player) player.ready((p) => onReady?.(p));\n    };\n    el.addEventListener("load", handleLoad);\n    return () => {\n      el.removeEventListener("load", handleLoad);\n      el.contentDocument?.getElementById("${id}")?.player?.destruct();\n    };\n  }, [onReady]);\n\n  return (\n    <object ref={ref} type="image/svg+xml" data="/${file}" aria-label="${label}"\n      style={{ width: "100%", maxWidth: ${DW} }} />\n  );\n}\n\n// Usage: <${comp} onReady={(player) => player.play()} />`;
  if (fw === 'vue')
    return `<template>\n  <object ref="anim" type="image/svg+xml" data="/${file}" aria-label="${label}"\n    style="width:100%;max-width:${DW}px" @load="onLoad" />\n</template>\n\n<script setup>\nimport { ref, onBeforeUnmount } from "vue";\n\nconst anim = ref(null);\nlet player = null;\n\nfunction onLoad() {\n  player = anim.value.contentDocument?.getElementById("${id}")?.player;\n  ${use.replace(/\n    /g, '\n  ')}\n}\n\nonBeforeUnmount(() => player?.destruct());\n<\/script>`;
  if (fw === 'angular')
    return `// ${comp.toLowerCase()}.component.ts\nimport { Component, ElementRef, OnDestroy, ViewChild } from "@angular/core";\n\n@Component({\n  selector: "app-${slug(doc.name)}",\n  standalone: true,\n  template: \`<object #anim type="image/svg+xml" data="assets/${file}" aria-label="${label}"\n    style="width:100%;max-width:${DW}px" (load)="onLoad()"></object>\`,\n})\nexport class ${comp}Component implements OnDestroy {\n  @ViewChild("anim") anim!: ElementRef<HTMLObjectElement>;\n  player: any;\n\n  onLoad() {\n    this.player = this.anim.nativeElement.contentDocument?.getElementById("${id}")?.player;\n    this.player?.ready((p: any) => p.on("end", () => console.log("finished")));\n  }\n\n  ngOnDestroy() { this.player?.destruct(); }\n}`;
  if (fw === 'svelte')
    return `<script>\n  import { onDestroy } from "svelte";\n  let el;\n  let player;\n\n  function onLoad() {\n    player = el.contentDocument?.getElementById("${id}")?.player;\n    player?.ready((p) => p.on("end", () => console.log("finished")));\n  }\n\n  onDestroy(() => player?.destruct());\n<\/script>\n\n<object bind:this={el} on:load={onLoad} type="image/svg+xml" data="/${file}"\n  aria-label="${label}" style="width:100%;max-width:${DW}px"></object>`;
  const get =
    ex.player === 'external'
      ? `// Get the player (inline SVG, or from an <object>'s contentDocument). With the external\n// player, svg.player is set once the player file has loaded: wait for "cinready".\nconst svg = document.getElementById("${id}");\nsvg.addEventListener("cinready", (e) => {\n  const player = e.detail;   // the same as svg.player (also .cinPlayer)\n});\n// SVGs added to the page later by script start with window.CinPlayer.boot(svg)\nconst player = svg.player;   // once ready\n`
      : `// Get the player (inline SVG, or from an <object>'s contentDocument)\nconst player = document.getElementById("${id}").player;   // also .cinPlayer\n`;
  return `${get}\n// Methods (all chainable)\nplayer.play();            // play from the current point; restarts if it has ended\nplayer.pause();\nplayer.toggle();          // alias: togglePlay()\nplayer.restart();\nplayer.reverse();         // flip direction and play\nplayer.rollback();        // play backwards to the start, then stop\nplayer.stop();            // stop and jump to the first frame\nplayer.seek(50);          // jump to 50%\nplayer.seekTo(1200);      // jump to 1200 ms\nplayer.seekBy(-250);      // move 250 ms back\nplayer.set("speed", 2);   // speed, fps (1–100), iterations (0 = infinite),\n                          // direction (1 | -1), alternate (bool), fill (1 | -1)\nplayer.ready((p) => {});  // runs once the player is ready\nplayer.destruct();        // detach the player and its listeners\n\n// Events: play, pause, restart, reverse, stop, end, keyframe\nplayer.on("end", (offsetMs) => console.log("ended at", offsetMs));\nplayer.on("keyframe", (offsetMs) => { /* every drawn frame */ });\nplayer.off("end");\n\n// Read-only state\nplayer.currentTime   // ms\nplayer.duration      // ms, one loop\nplayer.totalTime     // ms, all iterations\nplayer.state         // "playing" | "paused" | "ended" | "rollback"\nplayer.isPlaying, player.isReversed, player.isRollingBack, player.hasEnded,\nplayer.isInfinite, player.isAlternate, player.isBackwards,\nplayer.speed, player.fps, player.direction, player.fill, player.iterations`;
}
export let fwSel = 'html';
export function renderSnippet() {
  $('#xFw')
    .querySelectorAll('button')
    .forEach((b: HTMLElement) => b.classList.toggle('on', b.dataset.v === fwSel));
  $('#xSnip').value = snippet(fwSel);
  // self-hosting the external player only helps SVGs inline in the page (the HTML snippet)
  const selfHost = doc.ex.mode !== 'css' && doc.ex.player === 'external' && fwSel === 'html',
    dl = $('#xPlayerDl') as HTMLAnchorElement;
  dl.hidden = !selfHost;
  dl.href = `downloads/cin-player-${PLAYER_VERSION}.min.js`;
  dl.textContent = `Download the player (${PLAYER_VERSION})`;
  $('#xFwNote').innerHTML =
    doc.ex.mode === 'css' && fwSel !== 'api'
      ? 'CSS-only exports are plain animated images, so a normal <code>&lt;img&gt;</code> is all you need.'
      : selfHost
        ? 'Paste the SVG code into your page: every animation on the page then shares one player. Download the player to host it yourself, or leave out the first line and the SVG loads it from jsDelivr. SVGs added later by script (<code>innerHTML</code> doesn’t run scripts) start with <code>CinPlayer.boot(svg)</code>.'
        : FW_NOTES[fwSel];
}
export let lastExport = '';
export function setLastExport(c: string) {
  lastExport = c;
}

export function init(): void {
  $('#xTab').addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('button');
    if (!b) return;
    $('#xTab')
      .querySelectorAll('button')
      .forEach((x: HTMLElement) => x.classList.toggle('on', x === b));
    $('#xPanePrev').hidden = b.dataset.v !== 'preview';
    $('#xPaneEmbed').hidden = b.dataset.v !== 'embed';
  });
  $('#xFw').addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('button');
    if (!b) return;
    fwSel = b.dataset.v;
    renderSnippet();
  });
  $('#xSnipCopy').addEventListener('click', () => {
    const ta = $('#xSnip');
    try {
      navigator.clipboard.writeText(ta.value).then(
        () => toast('Snippet copied.'),
        () => {
          ta.select();
          toast('Press Ctrl+C to copy the selected code.');
        },
      );
    } catch (e) {
      ta.select();
      toast('Press Ctrl+C to copy the selected code.');
    }
  });
  $('#xOut').addEventListener('change', (e: Event) => {
    doc.ex.out = (e.target as any).value;
    save();
    updateExport();
  });
  $('#xFill').addEventListener('change', (e: Event) => {
    doc.ex.fill = (e.target as any).value;
    save();
    updateExport();
  });
  $('#xRm').addEventListener('change', (e: Event) => {
    const v = (e.target as any).value;
    if (v === 'first' || v === 'last') doc.ex.rm = v;
    else delete doc.ex.rm;
    save();
    updateExport();
  });
  $('#xFps').addEventListener('change', (e: Event) => {
    doc.ex.fps = parseInt((e.target as any).value) || 0;
    save();
    updateExport();
  });
  $('#xSpeed').addEventListener('change', (e: Event) => {
    const v = parseFloat((e.target as any).value);
    doc.ex.speed = isFinite(v) && v > 0 ? r3(clamp(v, 0.05, 20)) : 1;
    save();
    syncExportUI();
    updateExport();
  });
  $('#xFonts').addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('button');
    if (!b) return;
    doc.ex.fonts = b.dataset.v;
    save();
    syncExportUI();
    updateExport();
  });
  $('#xIds').addEventListener('click', (e: MouseEvent) => {
    const b = (e.target as any).closest('button');
    if (!b) return;
    doc.ex.ids = b.dataset.v;
    save();
    syncExportUI();
    updateExport();
  });
}
