// SVGcinema — help/topics/agent: Design agent (scenes and tour steps; the words are in help/content.json)
// These are reference topics (no guided tour: they need an account and a key, and a tour would spend the
// person's own key). Their steps still run here with Show me, for the website's clips and the tests. Nothing
// here ever reaches a real provider by itself: the key Show me types is an obvious fake, every setting stays
// in the practice page's memory (core/batch-mode), and tests/browser/help.py and site/captures.py answer the
// provider's address with canned replies (a chat, the Test, an image) for these topics.
import {
  DEFAULTS,
  getKeys,
  getSettings,
  removeKeys,
  setConfirmImages,
  setKey,
  setSettings,
} from '../../agent/settings';
import { clearChat } from '../../agent/chat';
import { ASSIST, canUndoSession } from '../../agent/assist';
import { BUSY } from '../../agent/busy';
import { isAgentOpen, render as renderAgent, toggleAgent } from '../../ui/agent-panel';
import { click, type } from '../ghost';
import { type Scene, type TourStep, allLayers, artboard, byName, lock, offEditor, q, shapeEl, svg640 } from '../kit';

/** the key Show me types, and the one the images topic starts with: plainly not a real one */
export const DEMO_KEY = 'sk-or-v1-demo-key';

/** A sky, a sun and hills: something for the agent (or your assistant) to work on. */
const SCENE = svg640(`<circle id="Sun" cx="500" cy="112" r="40" fill="#ffd36e"/>
<path id="Hills" d="M0 300c110-50 210-50 320-15s210 35 320-10v125H0z" fill="#1f2b5c"/>`);
const scene = (name: string): Scene => ({
  name,
  agent: true,
  svg: SCENE,
  setup() {
    lock('Sky', 'Hills');
  },
});

export const scenes: Record<string, Scene> = {
  'agent-key': scene('Practice: connect your own API key'),
  'agent-assistant': scene('Practice: use your AI assistant'),
  'agent-images': scene('Practice: pictures and vector'),
};

/* ---------- the panel's state ---------- */

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** waits (on timers, so the clip recorder's clock drives it) until `f` is true, at most `ms` */
async function until(f: () => boolean, ms = 30000) {
  for (let t = 0; t < ms && !f(); t += 100) await wait(100);
}
const shown = (sel: string) => {
  const e = q(sel) as HTMLElement | null;
  return !!e && !e.closest('[hidden]');
};
const inSettings = () => isAgentOpen() && shown('#agBody .ag-settings');
const inChat = () => isAgentOpen() && !inSettings();
const press = (sel: string) => (q(sel) as HTMLElement | null)?.click();
/** the panel's chat (from Settings: its ‹ button), drawn again */
function toChat() {
  if (!isAgentOpen()) toggleAgent(true);
  if (inSettings()) press('#agHead [data-act="back"]');
  renderAgent();
}
function toSettings() {
  if (!isAgentOpen()) toggleAgent(true);
  if (!inSettings()) press('#agHead [data-act="settings"]');
}
/** A known start, in this page's memory only (the practice editor reads the person's real settings):
 *  the agent's default settings, no keys (or the demo key), no chat, and Ask first on. */
function fresh(connect: '' | 'key' | 'assistant', key = false) {
  setSettings({ ...DEFAULTS, connect });
  removeKeys();
  if (key) setKey('openrouter', DEMO_KEY);
  setConfirmImages(true);
  clearChat();
  if (isAgentOpen()) renderAgent();
}
/** the panel open on its first screen, or on the setup that follows a choice */
function setUp(connect: '' | 'key' | 'assistant') {
  if (getSettings().connect !== connect) setSettings({ connect });
  toChat();
}
/** a native drop-down can't be opened by script: click it, as a person would, then pick the option */
async function pick(sel: string, value: string) {
  const s = q(sel) as HTMLSelectElement | null;
  if (!s) return;
  await click(s);
  s.value = value;
  s.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(500);
}
/** brings a control of the panel into view, as a person scrolls to it */
const into = (sel: string) => {
  const e = q(sel);
  if (e) e.scrollIntoView({ block: 'center' });
};
/** type in the chat and send it (Enter) */
async function ask(text: string) {
  await type(q('#agText') as HTMLInputElement, text);
}
/** the panel's last answer (a request, or your assistant's session) */
const lastTurn = () => Array.from(document.querySelectorAll('#agBody .ag-turn')).pop() || null;
const way = (v: string) => q(`#agBody .ag-way input[value="${v}"]`)?.closest('label') || null;

// Copy and Download notice the person's own click too (the tour waits for it)
const CLICKED = new Set<string>();
if (typeof document !== 'undefined')
  document.addEventListener(
    'click',
    e => {
      const b = (e.target as Element | null)?.closest?.('#agent [data-act]') as HTMLElement | null;
      if (b && b.dataset.act) CLICKED.add(b.dataset.act);
    },
    true,
  );

/* ---------- your AI assistant, played by a script (what it does through window.svgcinema) ---------- */

let simRunning = false;
/** What an assistant does when asked "make the sun breathe and pop a star in": the same calls it makes
 *  through window.svgcinema, a moment apart, so the panel shows its steps as they come. */
async function assistant() {
  const api = (window as any).svgcinema;
  if (!api || simRunning) return;
  simRunning = true;
  try {
    const r = api.start({ task: 'Make the sun breathe and pop a star in', assistant: 'Claude in Chrome' });
    if (r && r.error) return;
    await wait(700);
    await api.call('get_scene');
    await wait(800);
    const star = await api.call('add_shape', {
      kind: 'star',
      name: 'Star',
      cx: 170,
      cy: 90,
      r: 20,
      n: 5,
      inner: 0.45,
      fill: '#fff4c2',
    });
    await wait(800);
    if (star && star.id) await api.call('apply_preset', { preset: 'pop-in', ids: [star.id], at: 0.4 });
    await wait(800);
    const sun = byName('Sun');
    if (sun) await api.call('apply_preset', { preset: 'breathe', ids: [sun.id], at: 0, length: 3 });
    await wait(800);
    api.done('The sun breathes over the whole loop, and a star pops in at 0.4 s.');
    await wait(400);
  } finally {
    simRunning = false;
  }
}

/* ---------- the steps ---------- */

/** Open the Agent panel: the Agent button in the top bar. */
const openStep = (connect: '' | 'key' | 'assistant', key = false): TourStep => ({
  target: () => q('#bAgent'),
  enter: () => {
    if (isAgentOpen()) toggleAgent(false);
    fresh(connect, key);
  },
  done: () => isAgentOpen(),
  show: () => click(q('#bAgent')),
  clip: () => [isAgentOpen() ? q('#agBody .ag-setup') : null],
});

/** First open: how do you want to connect? (the way, then Continue) */
const wayStep = (v: 'key' | 'assistant'): TourStep => ({
  target: () => q('#agBody .ag-ways') || q('#bAgent'),
  enter: () => setUp(''),
  done: () => getSettings().connect === v,
  show: async () => {
    if (!isAgentOpen()) await click(q('#bAgent'));
    await click(way(v), 0.3, 0.3);
    await click(q('#agBody [data-act="way"]'));
  },
  clip: () => [q('#agBody .ag-setup'), q('#agBody .ag-connect .ag-how')],
});

const keyOf = () => getKeys().openrouter || '';

export const tours: Record<string, TourStep[]> = {
  'agent-key': [
    openStep(''),
    wayStep('key'),
    // the provider: OpenRouter (recommended), then Continue opens Settings
    {
      target: () => q('#agBody .ag-setup fieldset') || q('#agBody .ag-setup'),
      enter: () => {
        if (getSettings().connect !== 'key' || keyOf()) fresh('key');
        setUp('key');
      },
      done: () => inSettings(),
      show: async () => {
        await click(q('#agBody input[name="agProv"][value="openrouter"]')?.closest('label') || null, 0.3, 0.4);
        await click(q('#agBody [data-act="continue"]'));
      },
      clip: () => [q('#agBody .ag-setup fieldset'), q('#agBody .ag-setup [data-act="continue"]')],
    },
    // on the provider's website: make a key and copy it
    offEditor(),
    // paste it in API key
    {
      target: () => q('#agKey')?.closest('.ag-f') || null,
      enter: () => {
        if (getSettings().connect !== 'key') setSettings({ connect: 'key' });
        toSettings();
        into('#agKey');
      },
      done: () => !!keyOf(),
      show: () => type(q('#agKey') as HTMLInputElement, DEMO_KEY),
      clip: () => [q('#agBody .ag-sec')],
    },
    // pick a model, then Test
    {
      target: () => q('#agBody .ag-sec'),
      enter: c => {
        if (!keyOf()) setKey('openrouter', DEMO_KEY);
        toSettings();
        c.m = getSettings().model;
      },
      done: c =>
        getSettings().model !== c.m &&
        shown('#agBody .ag-checks') &&
        !/Testing/.test(q('#agBody .ag-checks')!.textContent || ''),
      show: async () => {
        await pick('#agModel', 'openai/gpt-5.5');
        await click(q('#agBody [data-act="test"]'));
        await until(() => shown('#agBody .ag-checks') && !/Testing/.test(q('#agBody .ag-checks')!.textContent || ''));
        await wait(600);
      },
      clip: () => [q('#agBody .ag-sec'), q('#agBody .ag-checks')],
    },
    // back to the chat
    {
      target: () => q('#agHead [data-act="back"]') || q('#agComp'),
      enter: () => {
        if (!keyOf()) setKey('openrouter', DEMO_KEY);
        toSettings();
      },
      done: () => inChat() && shown('#agComp'),
      show: () => click(q('#agHead [data-act="back"]')),
      clip: () => [q('#agBody .ag-hello'), q('#agComp')],
    },
  ],

  'agent-assistant': [
    openStep(''),
    wayStep('assistant'),
    // the starting message: Copy
    {
      target: () => q('#agBody [data-act="copystart"]'),
      enter: () => {
        setUp('assistant');
        CLICKED.delete('copystart');
      },
      done: () => CLICKED.has('copystart'),
      show: () => click(q('#agBody [data-act="copystart"]')),
      clip: () => [q('#agBody .ag-how'), shown('#toast') ? q('#toast') : null],
    },
    // in your assistant's own window: paste it and say what to make
    offEditor(),
    // your assistant works: its steps in the panel
    {
      target: () => q('#agBody .ag-steps') || q('#agBody .ag-status'),
      enter: c => {
        setUp('assistant');
        c.n = ASSIST.now ? ASSIST.now.id : 0;
      },
      done: c => {
        const s = ASSIST.now;
        return !!s && s.id !== c.n && !s.open && s.steps.length > 0;
      },
      show: () => assistant(),
      clip: () => [q('#agBody .ag-turn'), q('#agAsFoot'), shapeEl(byName('Star')), shapeEl(byName('Sun'))],
    },
    // Undo: all it did, in one step
    {
      target: () => q('#agAsFoot [data-act="asundo"]') || q('#agAsFoot'),
      enter: () => setUp('assistant'),
      done: () => {
        const s = ASSIST.now;
        return !!s && !s.open && s.steps.length > 0 && !s.changed;
      },
      show: async () => {
        if (!canUndoSession(ASSIST.now)) await assistant();
        await click(q('#agAsFoot [data-act="asundo"]'));
      },
      clip: () => [q('#agBody .ag-turn'), q('#agAsFoot'), artboard()],
    },
  ],

  'agent-images': [
    // Settings: Agent, then the cog (the demo key is set up)
    {
      target: () => (isAgentOpen() ? q('#agHead [data-act="settings"]') : q('#bAgent')),
      enter: () => {
        if (isAgentOpen()) toggleAgent(false);
        fresh('key', true);
      },
      done: () => inSettings(),
      show: async () => {
        if (!isAgentOpen()) await click(q('#bAgent'));
        await click(q('#agHead [data-act="settings"]'));
      },
      clip: () => [q('#bAgent'), q('#agHead')],
    },
    // Images: the service and the model
    {
      target: () => q('#agImgSel')?.closest('.ag-sec') || null,
      enter: c => {
        if (!keyOf()) fresh('key', true);
        toSettings();
        into('#agImgProv');
        c.m = getSettings().imgModel;
      },
      done: c => getSettings().imgModel !== c.m && !!getSettings().imgModel,
      show: () => pick('#agImgSel', 'google/gemini-3.1-flash-image'),
    },
    // the Images Test
    {
      target: () => q('#agBody [data-act="imgtest"]'),
      enter: () => {
        if (!keyOf()) fresh('key', true);
        toSettings();
        into('#agBody [data-act="imgtest"]');
      },
      done: () =>
        shown('#agBody [data-act="imgtest"]') &&
        !!q('#agBody [data-act="imgtest"]')!
          .closest('.ag-rows')
          ?.querySelector('.ag-checks .ag-chk.ok, .ag-checks .ag-chk.no'),
      show: async () => {
        await click(q('#agBody [data-act="imgtest"]'));
        await until(() => !!q('#agBody .ag-checks .ag-chk.ok, #agBody .ag-checks .ag-chk.no'));
        await wait(600);
      },
      clip: () => [q('#agImgSel')?.closest('.ag-sec') || null],
    },
    // ask for a picture: the card before it is made
    {
      target: () => q('#agComp'),
      enter: () => {
        if (!keyOf()) fresh('key', true);
      },
      done: () => shown('#agBody .ag-imgask'),
      show: async () => {
        if (!isAgentOpen()) await click(q('#bAgent'));
        if (inSettings()) await click(q('#agHead [data-act="back"]'));
        await ask('Paint a hot-air balloon picture for the sky');
        await until(() => shown('#agBody .ag-imgask') || !BUSY.on);
      },
      clip: () => [q('#agBody .ag-imgask')],
    },
    // Generate: it is made, then placed
    {
      target: () => q('#agBody .ag-imgask [data-act="imggo"]') || q('#agComp'),
      enter: c => (c.n = allLayers().filter(l => l.type === 'image').length),
      done: c => !BUSY.on && allLayers().filter(l => l.type === 'image').length > c.n,
      show: async () => {
        await click(q('#agBody .ag-imgask [data-act="imggo"]'));
        await wait(300);
        await until(() => !BUSY.on);
        await wait(400);
      },
      clip: () => [lastTurn(), shapeEl(byName('Balloon'))],
    },
    // vector: artwork whose parts move
    {
      target: () => q('#agComp'),
      enter: c => {
        if (!keyOf()) fresh('key', true);
        c.n = allLayers().length;
      },
      done: c => !BUSY.on && !!byName('Kite') && allLayers().length > c.n,
      show: async () => {
        if (!isAgentOpen()) await click(q('#bAgent'));
        if (inSettings()) await click(q('#agHead [data-act="back"]'));
        await ask('Add a kite whose tail swings in the wind');
        await wait(300);
        await until(() => !BUSY.on);
        await wait(400);
      },
      clip: () => [lastTurn(), shapeEl(byName('Tail')), shapeEl(byName('Body'))],
    },
  ],
};
