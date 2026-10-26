// SVGcinema — ui/agent-panel
// The design agent's panel, docked on the right at full height (layout A of the mockup): the chat
// with each request's steps, Undo this request, first open (connect a model), settings with a Test,
// and provider errors. Opened by the Agent button in the top bar or Alt+A.
import { $ } from '../core/constants';
import { setTime, undo } from '../core/history';
import { togglePlay } from '../core/playback';
import { S, layerById } from '../core/state';
import { toast } from '../io/open';
import { EXTRAS } from '../io/extras';
import { workAreaResized } from '../tools/hand';
import { BUSY, setBusy } from '../agent/busy';
import {
  CHAT,
  CHAT_FILE,
  REQUESTS,
  type Turn,
  chatHistory,
  chatJSON,
  clearChat,
  loadChat,
  persistChat,
  restoreChat,
} from '../agent/chat';
import { AgentError, type AgentErrorKind } from '../agent/clients/types';
import { describe, type StepIcon } from '../agent/describe';
import { runAgent } from '../agent/loop';
import {
  IMAGE_PROVIDERS,
  type ImageModel,
  defaultImageModel,
  imageCatalog,
  imageProviderById,
  modelsOf,
  money,
} from '../agent/images';
import { systemPrompt } from '../agent/prompt';
import { type ImageAnswer, type ImageAsk, offeredTools } from '../agent/tools';
import { PROVIDERS, type ProviderId, makeClient, providerById } from '../agent/providers';
import { isLatest } from '../agent/request';
import {
  confirmImages,
  currentChoice,
  getKeys,
  getSettings,
  imageChoice,
  imageProviderOf,
  removeKeys,
  setConfirmImages,
  setKey,
  setSettings,
  shortModel,
  vectorChoice,
} from '../agent/settings';

type View = 'chat' | 'settings';
interface Check {
  ok: boolean | 'warn';
  text: string;
  sub?: string;
}
const ST = {
  open: false,
  view: 'chat' as View,
  running: null as null | { id: number; ctl: AbortController; live: string },
  confirm: null as null | { id: number; names: string[]; resolve: (yes: boolean) => void },
  /** the image confirm card: what it asks, the prompt as edited, Don't ask again */
  imgAsk: null as null | {
    id: number;
    ask: ImageAsk;
    prompt: string;
    dontAsk: boolean;
    resolve: (a: ImageAnswer) => void;
  },
  /** an image being made */
  gen: null as null | { kind: 'image' | 'vector'; name: string; model: string; at: number },
  /** OpenRouter's image models, once read */
  cat: null as null | ImageModel[],
  imgOther: false,
  vecOther: false,
  /** setup: the provider picked on first open */
  pick: 'openrouter' as ProviderId,
  test: null as null | { running: boolean; checks: Check[]; at?: number },
  showKey: false,
  otherModel: false,
  /** older turns are folded to one line; ids of turns opened by hand */
  unfolded: new Set<number>(),
  folded: new Set<number>(),
};
const OPEN_KEY = 'svgcinema:agent.open',
  WIDTH_KEY = 'svgcinema:agent.width';

/* ---------- small helpers ---------- */

const esc = (s: string) =>
  String(s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
const svg = (d: string, s = 16, w = 1.4, vb = 16, cls = '') =>
  `<svg${cls ? ` class="${cls}"` : ''} width="${s}" height="${s}" viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const P = {
  bubble:
    '<path d="M3 3h10a1.5 1.5 0 011.5 1.5v5.5A1.5 1.5 0 0113 11.5H7.2L4 14v-2.5H3A1.5 1.5 0 011.5 10V4.5A1.5 1.5 0 013 3z"/><path d="M8 4.6l.75 1.65L10.4 7l-1.65.75L8 9.4l-.75-1.65L5.6 7l1.65-.75z" fill="currentColor" stroke="none"/>',
  newChat:
    '<path d="M8 2.5H4A1.5 1.5 0 002.5 4v8A1.5 1.5 0 004 13.5h8a1.5 1.5 0 001.5-1.5V8"/><path d="M11.8 2.2l2 2L8.5 9.5 6 10l.5-2.5z"/>',
  gear: '<circle cx="8" cy="8" r="2.1"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.15 1.15M11.25 11.25l1.15 1.15M3.6 12.4l1.15-1.15M11.25 4.75l1.15-1.15"/>',
  close: '<path d="M3 3l6 6M9 3l-6 6"/>',
  back: '<path d="M8.5 3L4.5 7l4 4"/>',
  chevDown: '<path d="M3 4.5l3 3 3-3"/>',
  chevRight: '<path d="M4.5 3l3 3-3 3"/>',
  play: '<path d="M3.5 1.8l7 4.2-7 4.2z" fill="currentColor" stroke="none"/>',
  undo: '<path d="M5.5 3.5L2.5 6.5l3 3"/><path d="M2.5 6.5h7a3.5 3.5 0 010 7H7"/>',
  send: '<path d="M7 11.5v-9M3.2 6.2L7 2.5l3.8 3.7"/>',
  eye: '<path d="M1.5 7S3.5 3 7 3s5.5 4 5.5 4-2 4-5.5 4S1.5 7 1.5 7z"/><circle cx="7" cy="7" r="1.6"/>',
  ok: '<path d="M3.5 8.5l3 3 6-7"/>',
  no: '<path d="M4 4l8 8M12 4l-8 8"/>',
  warn: '<path d="M8 3v6M8 12.5v.1"/>',
  alert: '<path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.5v3M8 11.3v.1"/>',
};
const STEP: Record<StepIcon, string> = {
  look: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>',
  add: '<path d="M8 3.5v9M3.5 8h9"/>',
  draw: '<path d="M8 1.8l4 6.4-4 6-4-6zM8 1.8v5M8 8.4h.01"/>',
  edit: '<path d="M3 5h10M3 11h10M6 3.5v3M10 9.5v3"/>',
  key: '<path d="M8 3l5 5-5 5-5-5z"/>',
  time: '<path d="M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 5v3.2l2.1 1.3"/>',
  del: '<path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9"/>',
  err: '<path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.5v3M8 11.3v.1"/>',
  image:
    '<path d="M4 3h8a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0112 13H4a1.5 1.5 0 01-1.5-1.5v-7A1.5 1.5 0 014 3zM2.5 11l3.5-3.5 3 3 1.8-1.8 2.7 2.7M10.5 5.8h.01"/>',
  place: '<path d="M8 2v12M2 8h12M6 4l2-2 2 2M6 12l2 2 2-2M4 6L2 8l2 2M12 6l2 2-2 2"/>',
};
const EXAMPLES = [
  'Draw a cartoon rocket and make it launch',
  'Animate the selected layers in, one by one',
  'Make the title bounce in',
];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------- open, close, resize ---------- */

const app = () => $('#app') as HTMLElement;
export function isAgentOpen() {
  return ST.open;
}
export function toggleAgent(open = !ST.open) {
  ST.open = open;
  ($('#agent') as HTMLElement).hidden = !open;
  app().classList.toggle('agent-on', open);
  $('#bAgent').setAttribute('aria-pressed', String(open));
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch (_) {
    /* remembered for this visit only */
  }
  if (open) {
    render();
    setTimeout(() => {
      const t = $('#agText') as HTMLTextAreaElement | null;
      if (t && ST.view === 'chat' && !t.closest('[hidden]')) t.focus();
    }, 0);
  }
  workAreaResized();
}
/** Alt+A: open or close the agent. Returns true when handled. */
export function agentShortcut(e: KeyboardEvent) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyA') return false;
  toggleAgent();
  return true;
}
function setWidth(w: number) {
  const v = Math.round(Math.max(300, Math.min(560, w)));
  app().style.setProperty('--agent-w', v + 'px');
  return v;
}

/* ---------- rendering ---------- */

function headHTML() {
  if (ST.view === 'settings')
    return `<button class="ag-ib" data-act="back" aria-label="Back to the chat" title="Back to the chat">${svg(P.back, 14, 1.5, 14)}</button>
      <span class="ag-title">Agent settings</span><span class="sp"></span>
      <button class="ag-ib" data-act="close" aria-label="Close the agent (Alt+A)" title="Close (Alt+A)">${svg(P.close, 12, 1.5, 12)}</button>`;
  return `<span class="ag-logo">${svg(P.bubble)}</span><span class="ag-title">Agent</span><span class="sp"></span>
    <button class="ag-ib" data-act="new" aria-label="New chat" title="New chat"${CHAT.turns.length && !ST.running ? '' : ' disabled'}>${svg(P.newChat, 15)}</button>
    <button class="ag-ib" data-act="settings" aria-label="Agent settings" title="Agent settings">${svg(P.gear, 15)}</button>
    <button class="ag-ib" data-act="close" aria-label="Close the agent (Alt+A)" title="Close (Alt+A)">${svg(P.close, 12, 1.5, 12)}</button>`;
}

function stepHTML(s: Turn['steps'][number]) {
  return `<div class="ag-step i-${s.icon}">${svg(STEP[s.icon], 14)}<span class="ag-step-t">${esc(s.label)}${
    s.meta ? `<small>${esc(s.meta)}</small>` : ''
  }</span></div>${
    s.costLine
      ? `<div class="ag-cost"><span>${esc(s.costLine)}${confirmImages() ? '' : ' ·'}</span>${
          confirmImages() ? '' : '<button class="ag-link" data-act="askimages">Ask first again</button>'
        }</div>`
      : ''
  }`;
}

function imgAskHTML() {
  const q = ST.imgAsk!,
    a = q.ask,
    n = a.kind === 'vector' ? 'vector artwork' : 'image';
  return `<div class="ag-card ag-confirm ag-imgask" role="group" aria-label="Confirm ${n} generation"><div class="ag-card-h">${svg(
    a.kind === 'vector' ? STEP.draw : STEP.image,
    15,
  )}<b>Generate ${a.kind === 'vector' ? 'vector artwork' : '1 image'}?</b></div>
  <label class="ag-ip"><span class="vh">Image prompt</span><textarea id="agImgPrompt" rows="3" dir="auto">${esc(q.prompt)}</textarea></label>
  <div class="ag-kv"><span>Model</span><span>${esc(a.model)} · ${esc(a.service)}</span><span>Size</span><span>${esc(a.size)}</span>${
    a.kind === 'image' ? `<span>Background</span><span>${a.transparent ? 'Transparent' : 'As drawn'}</span>` : ''
  }<span>Cost</span><b>${a.price === null ? 'price unknown' : 'about ' + money(a.price)}</b></div>
  <label class="ag-chkbox"><input type="checkbox" id="agDontAsk"${q.dontAsk ? ' checked' : ''}><span>Don’t ask again <small>· turn it back on in Settings</small></span></label>
  <div class="ag-card-b"><button class="ag-btn" data-act="imgcancel">Cancel</button><button class="ag-btn pri" data-act="imggo">Generate</button></div></div>`;
}

function genHTML() {
  const g = ST.gen!,
    secs = Math.round((Date.now() - g.at) / 1000);
  return `<div class="ag-gen"><div class="ag-gen-h">${svg(g.kind === 'vector' ? STEP.draw : STEP.image, 15)}<span>Generating ${
    g.kind === 'vector' ? 'vector' : 'image'
  } “${esc(g.name)}”<small>${esc(g.model)} · ${secs}s</small></span></div><div class="ag-gen-b">${svg(
    g.kind === 'vector' ? STEP.draw : STEP.image,
    22,
    1.2,
  )}<span>Usually 20–40 seconds</span></div></div>`;
}

const ERR_TITLE: Record<AgentErrorKind, string> = {
  auth: 'The key was refused',
  rate: 'The provider is busy',
  network: 'Couldn’t reach the provider',
  timeout: 'The provider stopped answering',
  aborted: 'Stopped',
  provider: 'The provider couldn’t answer',
  format: 'The provider’s answer couldn’t be read',
};

function turnHTML(t: Turn, last: boolean) {
  const running = ST.running && ST.running.id === t.id,
    req = REQUESTS.get(t.id),
    n = t.steps.length;
  let h = `<div class="ag-user" dir="auto">${esc(t.user)}</div>`;
  // older turns fold to one line (open them by hand); the last one stays open
  const folded = !last && !ST.unfolded.has(t.id) && !running;
  if (folded) {
    const what = t.reply ? t.reply.split(/(?<=[.!?])\s/)[0] : t.error ? ERR_TITLE[t.error.kind] : 'Done';
    return (
      h +
      `<button class="ag-fold" data-act="unfold" data-id="${t.id}" aria-expanded="false">${svg(P.chevRight, 10, 1.6, 12)}<span>${esc(
        what.length > 60 ? what.slice(0, 58) + '…' : what,
      )}</span>${n ? `<small>· ${plural(n, 'step')}</small>` : ''}</button>`
    );
  }
  h += `<div class="ag-turn"><div class="ag-who"><i></i>Agent · ${esc(shortModel(t.model))}</div>`;
  const live = running ? ST.running!.live : '';
  if (t.pre) h += `<p class="ag-text" dir="auto">${esc(t.pre)}</p>`;
  if (live && !n) h += `<p class="ag-text" dir="auto">${esc(live)}</p>`;
  if (n) {
    const open = !ST.folded.has(t.id);
    h += `<div class="ag-steps"><button class="ag-steps-h" data-act="steps" data-id="${t.id}" aria-expanded="${open}">${svg(
      open ? P.chevDown : P.chevRight,
      10,
      1.6,
      12,
    )}${plural(n, 'step')}${t.changed ? '<span>· one undo step</span>' : ''}</button>${open ? t.steps.map(stepHTML).join('') : ''}</div>`;
  }
  if (ST.confirm && ST.confirm.id === t.id)
    h += `<div class="ag-card ag-confirm" role="group" aria-label="Confirm delete"><div class="ag-card-h">${svg(STEP.del, 15)}<b>Delete ${plural(
      ST.confirm.names.length,
      'layer',
    )}?</b></div><p>${esc(ST.confirm.names.join(', '))}</p><div class="ag-card-b"><button class="ag-btn" data-act="keep">Keep</button><button class="ag-btn pri" data-act="delete">Delete</button></div></div>`;
  if (ST.imgAsk && ST.imgAsk.id === t.id) h += imgAskHTML();
  if (running && ST.gen) h += genHTML();
  if (live && n) h += `<p class="ag-text" dir="auto">${esc(live)}</p>`;
  if (!running && t.reply && t.reply !== t.pre) h += `<p class="ag-text" dir="auto">${esc(t.reply)}</p>`;
  if (running && !live && !ST.confirm && !ST.imgAsk && !ST.gen)
    h += `<div class="ag-working"><i></i><i></i><i></i><span>Working…</span></div>`;
  if (t.outcome === 'cap')
    h += `<p class="ag-note">Stopped after ${plural(n, 'step')}, the most for one request (Settings › Most steps per request).</p>`;
  if (t.outcome === 'stopped') h += `<p class="ag-note">Stopped · kept ${plural(n, 'step')}.</p>`;
  if (t.outcome === 'length') h += `<p class="ag-note">The answer was cut short by the model’s length limit.</p>`;
  if (t.outcome === 'error' && t.error)
    h += `<div class="ag-card ag-err" role="alert"><div class="ag-card-h">${svg(P.alert, 15, 1.5)}<b>${ERR_TITLE[t.error.kind]}</b></div><p>${esc(
      t.error.message,
    )} ${t.changed ? `Kept the ${plural(n, 'step')} done before it.` : 'Nothing in your project changed.'}</p><div class="ag-card-b left"><button class="ag-btn pri" data-act="retry" data-id="${t.id}">Try again</button><button class="ag-btn line" data-act="settings">Settings</button></div></div>`;
  if (!running && t.changed && last && req && isLatest(req))
    h += `<div class="ag-acts"><button class="ag-btn" data-act="play">${svg(P.play, 11, 1.4, 12)}Play</button><button class="ag-btn" data-act="undo" data-id="${t.id}">${svg(P.undo, 13, 1.5)}Undo this request</button></div>`;
  return h + '</div>';
}

function chatHTML() {
  if (!currentChoice() && !CHAT.turns.length) return setupHTML();
  if (!CHAT.turns.length)
    return `<div class="ag-hello"><span class="ag-tile">${svg(P.bubble, 20, 1.3)}</span><p>Ask for artwork or animation. The agent works in this project, and each request is one undo step.</p>${EXAMPLES.map(
      e => `<button class="ag-ex" data-act="example">${esc(e)}</button>`,
    ).join('')}</div>`;
  const ts = CHAT.turns;
  return `<div class="ag-msgs">${ts.map((t, i) => turnHTML(t, i === ts.length - 1)).join('')}</div>`;
}

function setupHTML() {
  const notes: Record<string, string> = {
    openrouter: 'One key for chat and images',
    openai: 'GPT models, chat and images',
    anthropic: 'Claude models · images need a second key',
    gemini: 'Google models, chat and images',
    groq: 'Fast open models · images need a second key',
    custom: 'Any OpenAI-compatible service: address, key and model name',
  };
  return `<div class="ag-setup">
    <span class="ag-tile">${svg(P.bubble, 20, 1.3)}</span>
    <h2>Make and animate by asking</h2>
    <p class="muted">Describe what you want. The agent draws, brings in images and animates them in this project. Each request is one undo step.</p>
    <fieldset><legend>Connect a model</legend>
    ${PROVIDERS.map(
      p =>
        `<label class="ag-radio${ST.pick === p.id ? ' on' : ''}"><input type="radio" name="agProv" value="${p.id}"${
          ST.pick === p.id ? ' checked' : ''
        }><span><b>${p.label}</b>${p.id === 'openrouter' ? '<em>Recommended</em>' : ''}<small>${notes[p.id]}</small></span></label>`,
    ).join('')}
    </fieldset>
    <button class="ag-btn pri wide" data-act="continue">Continue</button>
    <p class="ag-small">You’ll paste your API key next. It is kept in this browser only and sent straight to the provider, and requests use your own credit.</p>
    <div class="ag-rule"></div>
    <div class="ag-cap">ONCE CONNECTED, TRY</div>
    ${EXAMPLES.slice(0, 2)
      .map(e => `<button class="ag-ex" disabled>${esc(e)}</button>`)
      .join('')}
  </div>`;
}

function checkHTML(c: Check) {
  return `<div class="ag-chk ${c.ok === true ? 'ok' : c.ok === 'warn' ? 'warn' : 'no'}">${svg(
    c.ok === true ? P.ok : c.ok === 'warn' ? P.warn : P.no,
    12,
    1.8,
  )}<span>${esc(c.text)}${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</span></div>`;
}

function settingsHTML() {
  const s = getSettings(),
    p = providerById(s.provider)!,
    key = getKeys()[s.provider] || '',
    custom = p.id === 'custom',
    models = p.models,
    // a model name the list doesn't have is typed in a field
    other = !custom && (ST.otherModel || (!!s.model && !p.models.includes(s.model)));
  const sec = (title: string, body: string) =>
    `<section class="ag-sec"><h3>${svg(P.chevDown, 10, 1.6, 12)}${title}</h3><div class="ag-rows">${body}</div></section>`;
  const row = (label: string, ctl: string, forId = '') =>
    `<div class="ag-f"><label class="ag-l"${forId ? ` for="${forId}"` : ''}>${label}</label>${ctl}</div>`;
  let agent = row(
    'Provider',
    `<select class="sel" id="agProv">${PROVIDERS.map(
      x => `<option value="${x.id}"${x.id === p.id ? ' selected' : ''}>${x.label}</option>`,
    ).join('')}</select>`,
    'agProv',
  );
  if (custom) {
    agent += row(
      'Address',
      `<input class="txt" id="agBase" value="${esc(s.base)}" placeholder="https://api.example.com/v1" spellcheck="false">`,
      'agBase',
    );
    agent += row(
      'Model',
      `<input class="txt" id="agModelName" value="${esc(s.model)}" placeholder="Model name" spellcheck="false">`,
      'agModelName',
    );
  } else if (other) {
    agent += row(
      'Model',
      `<input class="txt" id="agModelName" value="${esc(s.model)}" placeholder="Model name, as the provider writes it" spellcheck="false">`,
      'agModelName',
    );
  } else {
    agent += row(
      'Model',
      `<select class="sel" id="agModel">${models
        .map(m => `<option value="${esc(m)}"${m === s.model ? ' selected' : ''}>${esc(m)}</option>`)
        .join('')}<option value="__other">Other model…</option></select>`,
      'agModel',
    );
  }
  agent += row(
    'API key',
    `<span class="ag-key"><input class="txt" id="agKey" type="${ST.showKey ? 'text' : 'password'}" value="${esc(key)}" placeholder="${
      custom ? 'Not needed for some local servers' : `Your ${p.label} key`
    }" autocomplete="off" spellcheck="false"><button class="ag-ib sm" data-act="showkey" aria-label="${ST.showKey ? 'Hide' : 'Show'} key" title="${
      ST.showKey ? 'Hide' : 'Show'
    } key">${svg(P.eye, 14, 1.3, 14)}</button></span><button class="ag-btn line" data-act="test"${ST.test && ST.test.running ? ' disabled' : ''}>Test</button>`,
    'agKey',
  );
  if (ST.test)
    agent += `<div class="ag-checks">${ST.test.running ? `<div class="ag-chk"><span>Testing…</span></div>` : ST.test.checks.map(checkHTML).join('')}</div>`;
  if (custom)
    agent += `<p class="ag-small ind">Results depend on the model: smaller ones may get steps wrong. A local server must allow this site’s address (CORS).</p>`;
  const ask = sec(
    'Ask first',
    `<div class="ag-sw-row tall"><span>Before generating images<small>Shows the model and the price, since it uses your credit</small></span><button class="ag-sw" role="switch" data-act="askimg" aria-checked="${confirmImages()}" aria-label="Ask before generating images"><i></i></button></div>
     <div class="ag-sw-row"><span>Before deleting layers</span><button class="ag-sw" role="switch" data-act="askdelete" aria-checked="${s.askDelete}" aria-label="Ask before deleting layers"><i></i></button></div>
     <div class="ag-sw-row"><label for="agSteps">Most steps per request</label><input class="txt ag-num" id="agSteps" inputmode="numeric" value="${s.maxSteps}"></div>`,
  );
  const priv = sec(
    'Privacy',
    `<p class="ag-small">Your keys stay in this browser and go straight to the provider; SVGcinema never sees them. The chat is saved with the project file.</p>
     <p class="ag-small">What you may do with generated images is set by the provider’s terms.</p>
     <div class="ag-btns"><button class="ag-btn" data-act="clearchat"${CHAT.turns.length ? '' : ' disabled'}>Clear chat</button><button class="ag-btn danger" data-act="removekeys"${
       Object.keys(getKeys()).length ? '' : ' disabled'
     }>Remove keys</button></div>`,
  );
  return `<div class="ag-settings">${sec('Agent model', agent)}${sec('Images', imagesHTML(row))}${ask}${priv}</div>`;
}

function imagesHTML(row: (label: string, ctl: string, forId?: string) => string) {
  const s = getSettings(),
    agentP = providerById(s.provider)!,
    id = imageProviderOf(s),
    ip = id ? imageProviderById(id)! : null;
  const sw = (act: string, on: boolean, text: string, sub = '') =>
    `<div class="ag-sw-row${sub ? ' tall' : ''}"><span>${text}${sub ? `<small>${sub}</small>` : ''}</span><button class="ag-sw" role="switch" data-act="${act}" aria-checked="${on}" aria-label="${text}"><i></i></button></div>`;
  let h = '';
  if (!agentP.images && (!id || id !== s.provider))
    h += `<p class="ag-note-box">${agentP.id === 'custom' ? 'This service' : agentP.label} has no image models here, so images use a service of their own.</p>`;
  h += row(
    'Provider',
    `<select class="sel" id="agImgProv"><option value="none"${id ? '' : ' selected'}>None</option>${IMAGE_PROVIDERS.map(
      x => `<option value="${x.id}"${x.id === id ? ' selected' : ''}>${x.label}</option>`,
    ).join('')}</select>`,
    'agImgProv',
  );
  if (!ip) return h + `<p class="ag-small">Without an image service the agent draws everything as vector shapes.</p>`;
  if (ip.id === 'custom')
    h += row(
      'Address',
      `<input class="txt" id="agImgBase" value="${esc(s.imgBase)}" placeholder="${esc(s.base || 'https://api.example.com/v1')}" spellcheck="false">`,
      'agImgBase',
    );
  // a service other than the agent's needs its own key (keys are kept per service)
  if (ip.id !== s.provider)
    h += row(
      'API key',
      `<span class="ag-key"><input class="txt" id="agImgKey" type="${ST.showKey ? 'text' : 'password'}" value="${esc(
        getKeys()[ip.id] || '',
      )}" placeholder="${ip.id === 'custom' ? 'Not needed for some local servers' : `Your ${ip.label} key`}" autocomplete="off" spellcheck="false" aria-label="Image API key"><button class="ag-ib sm" data-act="showkey" aria-label="${ST.showKey ? 'Hide' : 'Show'} key" title="${ST.showKey ? 'Hide' : 'Show'} key">${svg(P.eye, 14, 1.3, 14)}</button></span>`,
      'agImgKey',
    );
  const list = ip.id === 'openrouter' && ST.cat ? ST.cat : modelsOf(ip.id),
    raster = list.filter(m => !m.vector),
    vec = list.filter(m => m.vector),
    model = s.imgModel || defaultImageModel(ip.id),
    other = ip.id === 'custom' || ST.imgOther || (!!s.imgModel && !raster.some(m => m.id === s.imgModel));
  h += other
    ? row(
        'Image',
        `<input class="txt" id="agImgModel" value="${esc(s.imgModel)}" placeholder="Model name, as the service writes it" spellcheck="false">`,
        'agImgModel',
      )
    : row(
        'Image',
        `<select class="sel" id="agImgSel">${raster
          .map(
            m =>
              `<option value="${esc(m.id)}"${m.id === model ? ' selected' : ''}>${esc(m.name.replace(/^[^:]+:\s*/, ''))}</option>`,
          )
          .join('')}<option value="__other">Other model…</option></select>`,
        'agImgSel',
      );
  h += sw('transparent', s.transparent, 'Transparent background');
  h += sw(
    'prefervector',
    s.preferVector,
    'Prefer vector when parts move',
    'Makes SVG and imports it as separate, editable layers',
  );
  // vector models run on OpenRouter (Recraft) or a Custom service; elsewhere the agent draws vector itself
  if (ip.id === 'openrouter' || ip.id === 'custom') {
    const vOther =
      ST.vecOther ||
      (s.vector !== 'agent' && !!s.vector && ip.id === 'openrouter' && !vec.some(m => m.id === s.vector));
    h +=
      vOther || (ip.id === 'custom' && s.vector !== 'agent')
        ? row(
            'Vector',
            `<span class="ag-key"><input class="txt" id="agVecModel" value="${esc(s.vector === 'agent' ? '' : s.vector)}" placeholder="Vector model name" spellcheck="false"><button class="ag-ib sm" data-act="vecagent" aria-label="Let the agent draw vector" title="Let the agent draw vector">${svg(P.close, 12, 1.5, 12)}</button></span>`,
            'agVecModel',
          )
        : row(
            'Vector',
            `<select class="sel" id="agVecSel"><option value="agent"${s.vector === 'agent' ? ' selected' : ''}>Drawn by the agent</option>${vec
              .map(
                m =>
                  `<option value="${esc(m.id)}"${m.id === s.vector ? ' selected' : ''}>${esc(m.name.replace(/^[^:]+:\s*/, ''))}</option>`,
              )
              .join('')}<option value="__other">Other model…</option></select>`,
            'agVecSel',
          );
  }
  if (ip.id === 'openrouter' && !ST.cat)
    imageCatalog().then(m => {
      ST.cat = m;
      if (ST.view === 'settings') renderBody();
    });
  return h;
}

let raf = 0,
  genTimer: ReturnType<typeof setInterval> | undefined;
function scheduleRender() {
  if (!raf) raf = requestAnimationFrame(() => ((raf = 0), renderBody()));
}
function renderBody() {
  const b = $('#agBody') as HTMLElement;
  if (!b) return;
  const atEnd = b.scrollHeight - b.scrollTop - b.clientHeight < 40;
  const focus =
    document.activeElement && b.contains(document.activeElement) ? (document.activeElement as HTMLElement).id : '';
  b.innerHTML = ST.view === 'settings' ? settingsHTML() : chatHTML();
  if (focus) {
    const f = document.getElementById(focus) as HTMLInputElement | null;
    if (f) {
      f.focus();
      if (typeof f.value === 'string' && f.setSelectionRange) f.setSelectionRange(f.value.length, f.value.length);
    }
  }
  if (ST.view === 'chat' && (atEnd || ST.running)) b.scrollTop = b.scrollHeight;
  renderComposer();
}
function renderComposer() {
  const c = $('#agComp') as HTMLElement,
    inSetup = !currentChoice() && !CHAT.turns.length;
  c.hidden = ST.view !== 'chat' || inSetup;
  const running = !!ST.running,
    t = $('#agText') as HTMLTextAreaElement;
  t.placeholder = running ? 'Add to your next request…' : 'Describe what to make or change…';
  ($('#agSend') as HTMLElement).hidden = running;
  ($('#agStop') as HTMLElement).hidden = !running;
  ($('#agSend') as HTMLButtonElement).disabled = !t.value.trim();
  const ch = currentChoice();
  $('#agModelChip').textContent = ch ? shortModel(ch.model) : 'Set up a model';
  const n = S.selSet.size,
    one = n === 1 ? layerById([...S.selSet][0]) : null;
  $('#agScopeT').textContent = n === 0 ? 'Scene' : one ? one.name : `${n} layers`;
  $('#agFoot').textContent = ST.imgAsk
    ? 'Waiting for you to confirm the image'
    : ST.confirm
      ? 'Waiting for you to confirm'
      : running
        ? 'Working · Stop keeps what is done so far'
        : 'Uses your own API key · each request is one undo step';
}
export function render() {
  if (!ST.open) return;
  $('#agHead').innerHTML = headHTML();
  renderBody();
}

/* ---------- running a request ---------- */

async function send(text: string) {
  const choice = currentChoice();
  if (!choice) {
    ST.view = 'settings';
    return render();
  }
  if (ST.running || !text.trim()) return;
  const s = getSettings(),
    history = chatHistory(),
    turn: Turn = { id: CHAT.next++, user: text.trim(), reply: '', model: choice.model, steps: [], msgs: [] };
  CHAT.turns.push(turn);
  // the last request stays open; earlier ones fold to a line
  ST.unfolded.clear();
  ST.running = { id: turn.id, ctl: new AbortController(), live: '' };
  setBusy(true);
  render();
  let final = '';
  const r = await runAgent({
    client: makeClient(choice),
    text: turn.user,
    history,
    maxSteps: s.maxSteps,
    signal: ST.running.ctl.signal,
    tools: offeredTools(),
    system: systemPrompt({
      images: !!imageChoice(),
      vector: vectorChoice() ? 'model' : 'agent',
      preferVector: s.preferVector,
    }),
    ctx: {
      signal: ST.running.ctl.signal,
      confirmDelete: s.askDelete
        ? names =>
            new Promise<boolean>(resolve => {
              ST.confirm = { id: turn.id, names, resolve };
              scheduleRender();
            })
        : undefined,
      confirmImage: ask =>
        new Promise<ImageAnswer>(resolve => {
          ST.imgAsk = { id: turn.id, ask, prompt: ask.prompt, dontAsk: false, resolve };
          renderBody();
          const t = $('#agImgPrompt') as HTMLTextAreaElement | null;
          if (t) t.focus();
        }),
      generating: g => {
        ST.gen = g ? { ...g, at: Date.now() } : null;
        clearInterval(genTimer);
        if (g) genTimer = setInterval(scheduleRender, 1000);
        scheduleRender();
      },
    },
    onText: d => {
      if (ST.running) ST.running.live += d;
      scheduleRender();
    },
    onReply: m => {
      if (ST.running) ST.running.live = '';
      // what the agent says while it still has steps to run reads above the steps; its last answer below
      if (m.text && m.calls.length) turn.pre = turn.pre ? `${turn.pre}\n\n${m.text}` : m.text;
      else if (m.text) final = m.text;
      scheduleRender();
    },
    onStep: e => {
      turn.steps.push(describe(e));
      scheduleRender();
    },
  }).catch(e => ({
    added: [],
    steps: [],
    outcome: 'error' as const,
    error: e instanceof AgentError ? e : new AgentError('provider', String(e)),
    reply: '',
    changed: false,
    request: null as any,
  }));
  turn.reply = final;
  turn.outcome = r.outcome;
  turn.error = r.error ? { kind: r.error.kind, message: r.error.message } : undefined;
  turn.changed = r.changed;
  turn.msgs = r.added;
  if (r.request) REQUESTS.set(turn.id, r.request);
  if (ST.confirm) ST.confirm.resolve(false);
  ST.confirm = null;
  if (ST.imgAsk) ST.imgAsk.resolve({ go: false });
  ST.imgAsk = null;
  ST.gen = null;
  clearInterval(genTimer);
  ST.running = null;
  setBusy(false);
  persistChat();
  render();
}

/* ---------- settings actions ---------- */

async function runTest() {
  const ch = currentChoice();
  const s = getSettings(),
    p = providerById(s.provider)!;
  if (!ch) {
    ST.test = {
      running: false,
      checks: [
        { ok: false, text: p.id === 'custom' ? 'Add the address and model name first' : 'Add your API key first' },
      ],
    };
    return renderBody();
  }
  ST.test = { running: true, checks: [] };
  renderBody();
  const checks: Check[] = [];
  try {
    const r = await makeClient(ch).send({
      system: 'You are checking a connection. Call the ping tool once, then stop.',
      messages: [{ role: 'user', content: 'Call ping.' }],
      tools: [{ name: 'ping', description: 'Answers pong.', parameters: { type: 'object', properties: {} } }],
      signal: AbortSignal.timeout ? AbortSignal.timeout(45000) : undefined,
    });
    checks.push({ ok: true, text: 'Reachable from this page' }, { ok: true, text: 'Model found', sub: ch.model });
    checks.push(
      r.calls.some(c => c.name === 'ping')
        ? { ok: true, text: 'Can use tools', sub: 'needed to edit your project' }
        : {
            ok: false,
            text: 'Didn’t use the tool',
            sub: 'This model may not support tools, so it can’t edit your project.',
          },
    );
  } catch (e) {
    const ae = e instanceof AgentError ? e : new AgentError('provider', String(e));
    if (ae.kind === 'network') checks.push({ ok: false, text: 'Can’t reach it from this page', sub: ae.message });
    else {
      checks.push({ ok: true, text: 'Reachable from this page' });
      if (ae.kind === 'auth') checks.push({ ok: false, text: 'The key was refused', sub: ae.message });
      else if (ae.status === 404) checks.push({ ok: false, text: 'Model not found', sub: ae.message });
      else checks.push({ ok: ae.kind === 'rate' ? 'warn' : false, text: ERR_TITLE[ae.kind], sub: ae.message });
    }
  }
  ST.test = { running: false, checks, at: Date.now() };
  renderBody();
}

function onChange(e: Event) {
  const t = e.target as HTMLInputElement;
  const s = getSettings();
  switch (t.id) {
    case 'agProv': {
      const p = providerById(t.value)!;
      setSettings({ provider: p.id, model: p.models[0] || '' });
      ST.otherModel = p.id !== 'custom' && !p.models.length;
      ST.test = null;
      return renderBody();
    }
    case 'agModel':
      if (t.value === '__other') {
        ST.otherModel = true;
        setSettings({ model: '' });
        renderBody();
        return ($('#agModelName') as HTMLInputElement).focus();
      }
      setSettings({ model: t.value });
      ST.test = null;
      return renderComposer();
    case 'agModelName':
      setSettings({ model: t.value.trim() });
      ST.test = null;
      return renderComposer();
    case 'agBase':
      setSettings({ base: t.value.trim() });
      ST.test = null;
      return renderComposer();
    case 'agKey':
      setKey(s.provider, t.value);
      ST.test = null;
      return renderBody();
    case 'agImgProv':
      setSettings({ imgProvider: t.value as any, imgModel: '', vector: 'agent' });
      ST.imgOther = ST.vecOther = false;
      return renderBody();
    case 'agImgSel':
      if (t.value === '__other') {
        ST.imgOther = true;
        setSettings({ imgModel: '' });
        renderBody();
        return ($('#agImgModel') as HTMLInputElement).focus();
      }
      return setSettings({ imgModel: t.value });
    case 'agImgModel':
      return setSettings({ imgModel: t.value.trim() });
    case 'agImgBase':
      return setSettings({ imgBase: t.value.trim() });
    case 'agImgKey': {
      const id = imageProviderOf();
      if (id) setKey(id, t.value);
      return renderBody();
    }
    case 'agVecSel':
      if (t.value === '__other') {
        ST.vecOther = true;
        renderBody();
        return ($('#agVecModel') as HTMLInputElement).focus();
      }
      return setSettings({ vector: t.value });
    case 'agVecModel':
      return setSettings({ vector: t.value.trim() || 'agent' });
    case 'agDontAsk':
      if (ST.imgAsk) ST.imgAsk.dontAsk = t.checked;
      return;
    case 'agSteps':
      setSettings({ maxSteps: parseInt(t.value) || s.maxSteps });
      return renderBody();
  }
  if (t.name === 'agProv') {
    ST.pick = t.value as ProviderId;
    renderBody();
  }
}

function onClick(e: MouseEvent) {
  const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!b || (b as HTMLButtonElement).disabled) return;
  const id = Number(b.dataset.id);
  switch (b.dataset.act) {
    case 'close':
      return toggleAgent(false);
    case 'settings':
      ST.view = 'settings';
      return render();
    case 'back':
      ST.view = 'chat';
      return render();
    case 'new': {
      const old = clearChat();
      render();
      toast('Chat cleared.', {
        label: 'Undo',
        run: () => {
          CHAT.turns = old.turns;
          CHAT.next = old.next;
          persistChat();
          render();
        },
      });
      return;
    }
    case 'continue': {
      const p = providerById(ST.pick)!;
      setSettings({ provider: p.id, model: p.models[0] || '' });
      ST.otherModel = p.id === 'custom' ? false : !p.models.length;
      ST.view = 'settings';
      render();
      const k = $(p.id === 'custom' ? '#agBase' : '#agKey') as HTMLInputElement | null;
      if (k) k.focus();
      return;
    }
    case 'example': {
      const t = $('#agText') as HTMLTextAreaElement;
      t.value = b.textContent || '';
      t.focus();
      return renderComposer();
    }
    case 'unfold':
      ST.unfolded.add(id);
      return renderBody();
    case 'steps':
      ST.folded.has(id) ? ST.folded.delete(id) : ST.folded.add(id);
      return renderBody();
    case 'keep':
    case 'delete':
      if (ST.confirm) {
        ST.confirm.resolve(b.dataset.act === 'delete');
        ST.confirm = null;
        renderBody();
      }
      return;
    case 'retry': {
      const t = CHAT.turns.find(x => x.id === id);
      if (t) send(t.user);
      return;
    }
    case 'undo': {
      const r = REQUESTS.get(id);
      if (r && isLatest(r)) {
        undo();
        toast('Undid the request.');
      }
      return renderBody();
    }
    case 'play':
      setTime(0);
      if (!S.playing) togglePlay();
      return;
    case 'showkey':
      ST.showKey = !ST.showKey;
      return renderBody();
    case 'test':
      runTest();
      return;
    case 'imggo':
    case 'imgcancel':
      if (ST.imgAsk) {
        const q = ST.imgAsk,
          ta = $('#agImgPrompt') as HTMLTextAreaElement | null;
        ST.imgAsk = null;
        q.resolve(
          b.dataset.act === 'imggo'
            ? { go: true, prompt: ta ? ta.value : q.prompt, dontAsk: q.dontAsk }
            : { go: false },
        );
        renderBody();
      }
      return;
    case 'askimages':
      setConfirmImages(true);
      toast('The agent will ask before generating images.');
      return renderBody();
    case 'askimg':
      setConfirmImages(!confirmImages());
      return renderBody();
    case 'transparent':
      setSettings({ transparent: !getSettings().transparent });
      return renderBody();
    case 'prefervector':
      setSettings({ preferVector: !getSettings().preferVector });
      return renderBody();
    case 'vecagent':
      ST.vecOther = false;
      setSettings({ vector: 'agent' });
      return renderBody();
    case 'askdelete':
      setSettings({ askDelete: !getSettings().askDelete });
      return renderBody();
    case 'clearchat': {
      clearChat();
      return render();
    }
    case 'removekeys':
      removeKeys();
      ST.test = null;
      toast('Removed your API keys from this browser.');
      return render();
  }
}

/* ---------- set up ---------- */

export function init(): void {
  const host = $('#agent') as HTMLElement;
  host.innerHTML = `<div class="ag-grip" title="Drag to resize" aria-hidden="true"></div>
    <div class="ag-head" id="agHead"></div>
    <div class="ag-body" id="agBody"></div>
    <div class="ag-comp" id="agComp">
      <div class="ag-box">
        <label class="vh" for="agText">Message the agent</label>
        <textarea class="ag-ta" id="agText" rows="2" dir="auto"></textarea>
        <div class="ag-row">
          <span class="ag-chip" id="agScope" title="What the agent sees selected">${svg(
            '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke-dasharray="2.2 1.8"/>',
            12,
          )}<span id="agScopeT">Scene</span></span>
          <button class="ag-chip" id="agModelChip" data-act="settings" title="Agent model (Settings)"></button>
          <span class="sp"></span>
          <button class="ag-send" id="agSend" aria-label="Send" title="Send (Enter)">${svg(P.send, 13, 1.7, 14)}</button>
          <button class="ag-stop" id="agStop" aria-label="Stop" title="Stop" hidden><i></i></button>
        </div>
      </div>
      <div class="ag-foot" id="agFoot"></div>
    </div>`;
  $('#bAgent').innerHTML = svg(P.bubble, 15) + 'Agent';
  host.addEventListener('click', onClick);
  host.addEventListener('change', onChange);
  // the image prompt keeps what was typed when the card is drawn again
  host.addEventListener('input', e => {
    const t = e.target as HTMLTextAreaElement;
    if (t.id === 'agImgPrompt' && ST.imgAsk) ST.imgAsk.prompt = t.value;
  });
  const ta = $('#agText') as HTMLTextAreaElement;
  ta.addEventListener('input', () => {
    ($('#agSend') as HTMLButtonElement).disabled = !ta.value.trim();
    ta.style.height = 'auto';
    ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!ST.running && ta.value.trim()) {
        const v = ta.value;
        ta.value = '';
        ta.style.height = '';
        send(v);
      }
    }
  });
  $('#agSend').addEventListener('click', () => {
    if (!ta.value.trim()) return;
    const v = ta.value;
    ta.value = '';
    ta.style.height = '';
    send(v);
  });
  $('#agStop').addEventListener('click', () => {
    if (!ST.running) return;
    if (ST.confirm) {
      ST.confirm.resolve(false);
      ST.confirm = null;
    }
    ST.running.ctl.abort();
  });
  $('#bAgent').addEventListener('click', () => toggleAgent());
  // drag the left edge to resize (remembered)
  const grip = host.querySelector('.ag-grip') as HTMLElement;
  grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    const x0 = e.clientX,
      w0 = host.getBoundingClientRect().width;
    grip.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      setWidth(w0 + (x0 - m.clientX));
      workAreaResized();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(host.getBoundingClientRect().width)));
      } catch (_) {
        /* not remembered */
      }
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up, { once: true });
  });
  // the chat travels with the project file
  EXTRAS.write.push(() =>
    CHAT.turns.length ? { name: CHAT_FILE, data: new TextEncoder().encode(chatJSON()), compress: true } : null,
  );
  EXTRAS.reset.push(() => {
    if (ST.running) ST.running.ctl.abort();
    clearChat();
    render();
  });
  EXTRAS.read.push(async z => {
    loadChat(await z.text(CHAT_FILE));
    persistChat();
    render();
  });
  // the selection chip follows the selection
  document.addEventListener('click', () => ST.open && !ST.running && renderComposer(), true);
  restoreChat();
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    if (w) setWidth(w);
    if (localStorage.getItem(OPEN_KEY) === '1') toggleAgent(true);
  } catch (_) {
    /* starts closed */
  }
  if (BUSY.on) setBusy(false);
}
