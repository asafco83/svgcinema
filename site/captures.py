# SVGcinema — the website's clips of the editor
# Every picture of the editor's UI on the website is a recording of the running editor, never redrawn by hand:
# short looping clips (MP4, H.264) with a poster frame (WebP), in the light and the dark theme, in site/img/.
# Run it after a UI change that shows in them, with the dev server on port 5199 (npx vite --port 5199):
#   python3 site/captures.py [http://localhost:5199/] [light|dark] [clip names…]
# The help topics' step clips (Help & tutorials) are recorded too, into public/help/ (the editor's Help panel
# shows them, and the website's help pages load them from the editor): `help` records them all, `help:<topic>`
# one topic's. Each is a recording of the tour's own "Show me" for that step, in the tutorial's practice
# scene, so the clips always match the tour.
# Needs Playwright for Python (Chromium), Pillow and ffmpeg (libx264).
#
# Frames are exactly 1/FPS apart however long a screenshot takes: site/clock.js runs in every frame of the page
# and, once frozen, time moves only when the recorder ticks it (rAF, timers, Date, CSS and SMIL animations).
# The design agent's turns are scripted: Playwright answers OpenRouter's URL with canned streams (as in
# tests/browser/agent-*.py), so no model or key is used.
import asyncio, base64, io, json, os, re, shutil, subprocess, sys, tempfile
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'site/img')
HELP = os.path.join(ROOT, 'public/help')
ARGS = [a for a in sys.argv[1:] if not a.startswith('http') and a not in ('light', 'dark')]
THEMES = [a for a in sys.argv[1:] if a in ('light', 'dark')] or ['light', 'dark']
BASE = next((a for a in sys.argv[1:] if a.startswith('http')), 'http://localhost:5199/')
CLOCK = open(os.path.join(ROOT, 'site/clock.js')).read()
FPS = 25
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS'}
ALL = "(()=>{const all=[];const w=a=>a.forEach(l=>{all.push(l);if(l.ch)w(l.ch)});w(st.doc.layers);return all})()"
os.makedirs(IMG, exist_ok=True)


def want(name):
    return not ARGS or name in ARGS


def oai(text=None, tools=None):
    s = ''
    if text:
        s += 'data: ' + json.dumps({'choices': [{'index': 0, 'delta': {'content': text}}]}) + '\n\n'
    for n, (name, args) in enumerate(tools or []):
        s += 'data: ' + json.dumps({'choices': [{'index': 0, 'delta': {'tool_calls': [{'index': n, 'id': f'c{n}', 'function': {'name': name, 'arguments': json.dumps(args)}}]}}]}) + '\n\n'
    s += 'data: ' + json.dumps({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls' if tools else 'stop'}]}) + '\n\n'
    return s + 'data: [DONE]\n\n'


def squeeze_rows(im):
    """The rows to keep when long runs of empty rows (an agent panel's blank chat area) are squeezed out."""
    w, h = im.size
    px = im.load()

    def blank(y):
        c = px[w // 2, y]
        return all(sum(abs(a - b) for a, b in zip(px[x, y], c)) <= 12 for x in range(4, w - 4, 7))

    rows, y = [], 0
    while y < h:
        if blank(y):
            e = y
            while e < h and blank(e):
                e += 1
            rows += list(range(y, y + 24)) + list(range(e - 24, e)) if e - y > 120 else list(range(y, e))
            y = e
        else:
            rows.append(y)
            y += 1
    return rows


def keep_rows(im, rows):
    out = Image.new('RGB', (im.size[0], len(rows)))
    for i, yy in enumerate(rows):
        out.paste(im.crop((0, yy, im.size[0], yy + 1)), (0, i))
    return out


class Rec:
    """Records one clip: begin() freezes the page's clock, each frame ticks it by 1/FPS and takes a screenshot of
    the region, end() writes site/img/<name>.mp4 and its poster <name>.webp."""

    def __init__(self, pg, name, region, squeeze=False, maxw=1800, poster=0.5, wait=0, out=IMG):
        self.pg, self.name, self.region, self.squeeze, self.maxw, self.poster, self.wait, self.out = pg, name, region, squeeze, maxw, poster, wait, out
        self.frames = []

    async def begin(self):
        r = self.region
        if isinstance(r, str):
            b = await self.pg.locator(r).first.bounding_box()
            r = {'x': b['x'], 'y': b['y'], 'width': b['width'], 'height': b['height']}
        self.clip = {k: round(v) for k, v in r.items()}
        await self.tick(0)
        return self

    async def tick(self, ms):
        for f in self.pg.frames:
            try:
                await f.evaluate('([c,ms])=>{if(!window.__tick)(0,eval)(c);__tick(ms)}', [CLOCK, ms])
            except Exception:
                pass

    async def frame(self, n=1, wait=None):
        for _ in range(n):
            await self.tick(1000 / FPS)
            w = self.wait if wait is None else wait
            if w:
                await self.pg.wait_for_timeout(w)
            self.frames.append(await self.pg.screenshot(clip=self.clip, scale='device', type='png'))

    async def hold(self, sec, wait=None):
        await self.frame(max(1, round(sec * FPS)), wait)

    async def end(self):
        d = tempfile.mkdtemp()
        rows = None
        if self.squeeze:
            rows = squeeze_rows(Image.open(io.BytesIO(self.frames[-1])).convert('RGB'))
        for i, f in enumerate(self.frames):
            im = Image.open(io.BytesIO(f)).convert('RGB')
            if rows:
                im = keep_rows(im, rows)
            im.save(f'{d}/{i:05d}.png')
        mp4 = os.path.join(self.out, self.name + '.mp4')
        vf = f'scale=trunc(min(iw\\,{self.maxw})/2)*2:-2:flags=lanczos'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', f'{d}/%05d.png', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4], check=True)
        # the poster: the same frame size as the video
        n = min(len(self.frames) - 1, int(self.poster * len(self.frames)))
        p = os.path.join(self.out, self.name + '.webp')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{d}/{n:05d}.png', '-vf', vf, '-q:v', '86', p], check=True)
        shutil.rmtree(d)
        print(f'{os.path.relpath(mp4, ROOT)} {len(self.frames) / FPS:.1f}s {os.path.getsize(mp4) // 1024} KB, poster {os.path.getsize(p) // 1024} KB')


async def page(b, theme, settings=None, route=None, tl=None):
    c = await b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=2)
    pg = await c.new_page()
    pg.set_default_timeout(10000)
    if route:
        await pg.route('https://openrouter.ai/**', route)
    await pg.add_init_script(CLOCK)
    init = f"localStorage.setItem('svgcinema:theme','{theme}');"
    if tl:
        init += f"localStorage.setItem('svgcinema:tlH','{tl}');"
    if settings:
        init += "localStorage.setItem('svgcinema:agent.keys', JSON.stringify({openrouter:'test-key'}));"
        init += f"localStorage.setItem('svgcinema:agent.settings', {json.dumps(json.dumps(settings))});"
    await pg.add_init_script(init)
    await pg.goto(BASE)
    await pg.wait_for_timeout(2500)
    await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); }")
    return c, pg


def pick(*names):
    """JS: select the sample layers with these names (the first replaces the selection)."""
    js = ''.join(f"hi.select(a.find(l=>l.name==={json.dumps(n)}).id{',' + repr('toggle') if i else ''});" for i, n in enumerate(names))
    return f"(()=>{{const a={ALL};{js}}})()"


EDITOR_R = {'x': 300, 'y': 52, 'width': 1140, 'height': 560}  # the canvas and the inspector
DRAW_R = {'x': 0, 'y': 52, 'width': 804, 'height': 560}  # the tool rail, the Layers panel and the canvas


async def type_in(rec, sel, text, per=2):
    for ch in text:
        await rec.pg.locator(sel).press_sequentially(ch)
        await rec.frame(per)


async def drag(rec, a, b, frames=14):
    pg = rec.pg
    await pg.mouse.move(*a)
    await pg.mouse.down()
    await rec.frame(2)
    for i in range(1, frames + 1):
        t = i / frames
        t = t * t * (3 - 2 * t)
        await pg.mouse.move(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        await rec.frame(1)
    await pg.mouse.up()
    await rec.frame(2)


async def clips(b, theme):
    sfx = '' if theme == 'light' else '-dark'
    key = {'provider': 'openrouter', 'model': 'anthropic/claude-sonnet-5.5', 'connect': 'key'}

    # ---------- Help & tutorials: the Help panel on a topic, then a guided tour beside it ----------
    if want('help-panel'):
        c, pg = await page(b, theme)
        rec = await Rec(pg, 'help-panel' + sfx, {'x': 0, 'y': 0, 'width': 1440, 'height': 900}, maxw=1440, poster=0.85, wait=20).begin()
        await rec.hold(0.5)
        await pg.keyboard.press('Shift+F1')
        await rec.hold(1.2)
        await pg.click('#help [data-topic="keyframes"]')
        await rec.hold(1.6)
        for i in range(20):
            await pg.evaluate("document.getElementById('hpBody').scrollTop += 9")
            await rec.frame(1)
        await rec.hold(0.6)
        await pg.evaluate("document.getElementById('hpBody').scrollTop = 0")
        await rec.frame(1)
        await pg.click('#help [data-tour="keyframes"]')
        for i in range(60):
            await rec.frame(1, wait=40)
            ok = await pg.evaluate("(()=>{const f=document.querySelector('.prac-frame');return !!(f&&f.contentWindow&&f.contentWindow.cinTour)})()")
            if ok:
                break
        await rec.hold(1.0)
        for step in range(2):
            await pg.click('#help [data-cmd="show"]')
            for i in range(FPS * 6):
                await rec.frame(1)
                if not await pg.evaluate("!!document.querySelector('#help [data-cmd=\"show\"][disabled]')") and i > 10:
                    break
            await rec.hold(1.4)
        await rec.end()
        await c.close()

    # ---------- the design agent: a request, its steps, the answer ----------
    if want('talk'):
        pg = None

        async def chat(r):
            q = r.request
            if q.method == 'OPTIONS':
                return await r.fulfill(status=204, headers=CORS)
            if q.method == 'GET':
                return await r.fulfill(status=404, headers=CORS, body='')
            msgs = json.loads(q.post_data)['messages']
            last = [i for i, m in enumerate(msgs) if m['role'] == 'user'][-1]
            tools = [m for m in msgs[last:] if m['role'] == 'tool']
            ids = await pg.evaluate(f"(()=>{{const a={ALL};const f=n=>a.find(l=>l.name===n).id;return {{sun:f('Sun'),title:f('Title')}}}})()")
            await asyncio.sleep(1.5)  # the model thinking: frames keep coming meanwhile
            if not tools:
                out = oai('I’ll give the sun a slow breathe and pop the title in once the sun is up.', [('apply_preset', {'preset': 'breathe', 'ids': [ids['sun']], 'at': 0})])
            elif len(tools) == 1:
                out = oai(None, [('apply_preset', {'preset': 'pop-in', 'ids': [ids['title']], 'at': 2})])
            else:
                out = oai('Done. The sun breathes over the whole loop, and the title pops in at 2 s, after the sun has cleared the hills. Want the rays to turn faster too?')
            await r.fulfill(status=200, headers={**CORS, 'content-type': 'text/event-stream'}, body=out)

        c, pg = await page(b, theme, key, chat)
        await pg.click('#bAgent')
        await pg.wait_for_timeout(500)
        rec = await Rec(pg, 'talk' + sfx, '#agent', squeeze=True, poster=1, wait=40).begin()
        await rec.hold(0.6)
        await type_in(rec, '#agText', 'Make the sun breathe and pop the title in after it rises', 1)
        await rec.hold(0.4)
        await pg.press('#agText', 'Enter')
        for _ in range(200):
            await rec.frame(1, 60)
            if await pg.evaluate("!!document.querySelector('#agent') && /Want the rays/.test(document.getElementById('agent').textContent)"):
                break
        await rec.hold(3.5)
        await rec.end()
        await c.close()

    # ---------- the agent's first screen: how to connect ----------
    if want('ways'):
        c, pg = await page(b, theme)
        await pg.click('#bAgent')
        await pg.wait_for_timeout(500)
        rec = await Rec(pg, 'ways' + sfx, '#agent', squeeze=True, poster=0.3).begin()
        await rec.hold(1.2)
        await pg.click('.ag-way:has(input[value=key])')
        await rec.hold(1.6)
        await pg.click('.ag-way:has(input[value=assistant])')
        await rec.hold(1.6)
        await rec.end()
        await c.close()

    # ---------- the agent's cards: Vector or image? and Generate 1 image? ----------
    async def cards(r):
        q = r.request
        if q.method == 'OPTIONS':
            return await r.fulfill(status=204, headers=CORS)
        if q.method == 'GET':
            return await r.fulfill(status=404, headers=CORS, body='')
        msgs = json.loads(q.post_data)['messages']
        last = [i for i, m in enumerate(msgs) if m['role'] == 'user'][-1]
        user = msgs[last]['content'] if isinstance(msgs[last]['content'], str) else json.dumps(msgs[last]['content'])
        await asyncio.sleep(1.2)
        if any(m['role'] == 'tool' for m in msgs[last:]):
            out = oai('Stopped.')
        elif 'moon' in user:
            out = oai(None, [('generate_image', {'prompt': 'a watercolour moon with soft craters', 'name': 'Moon', 'either': True})])
        else:
            out = oai(None, [('generate_image', {'prompt': 'A watercolour hot-air balloon, soft paper texture', 'name': 'Balloon'})])
        await r.fulfill(status=200, headers={**CORS, 'content-type': 'text/event-stream'}, body=out)

    img = {**key, 'preferVector': False, 'vector': 'agent', 'imgProvider': 'openrouter', 'transparent': True}
    for ask, sel, name in [('Add a moon to the sky', '.ag-kind', 'vector-card'), ('Paint a hot-air balloon picture', '.ag-imgask', 'picture-card')]:
        if not want(name):
            continue
        c, pg = await page(b, theme, img, cards)
        await pg.click('#bAgent')
        await pg.wait_for_timeout(500)
        rec = await Rec(pg, name + sfx, '#agent', squeeze=True, poster=1, wait=40).begin()
        await rec.hold(0.5)
        await type_in(rec, '#agText', ask, 1)
        await rec.hold(0.3)
        await pg.press('#agText', 'Enter')
        for _ in range(200):
            await rec.frame(1, 60)
            if await pg.locator(sel).count():
                break
        await rec.hold(3)
        await rec.end()
        await c.close()

    # ---------- the editor ----------
    names = ['timeline', 'tracks', 'tools', 'filters', 'multi', 'easing', 'presets']
    if any(want(n) for n in names):
        c, pg = await page(b, theme)
        E = pg.evaluate

        async def play(name, region, sec=3.0, **kw):
            """One loop of the scene playing, from 0:00."""
            await E('hi.setTime(0)')
            await pg.wait_for_timeout(300)
            rec = await Rec(pg, name + sfx, region, **kw).begin()
            await pg.keyboard.press('Space')
            await rec.hold(sec)
            await pg.keyboard.press('Space')
            await rec.end()
            await pg.wait_for_timeout(300)

        await E(pick('Rays'))
        if want('timeline'):
            await play('timeline', '.panel.tl')
        if want('tracks'):
            await play('tracks', EDITOR_R)
        if want('tools'):
            # pick a tool by its key, draw, and undo back to where it started
            await E('(hi.select(null),hi.setTime(2.4))')
            await pg.wait_for_timeout(400)
            ab = await E("(()=>{const r=document.getElementById('artboard').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
            X = lambda fx: ab[0] + ab[2] * fx
            Y = lambda fy: ab[1] + ab[3] * fy
            rec = await Rec(pg, 'tools' + sfx, DRAW_R, poster=0.62).begin()
            await rec.hold(0.6)
            await pg.keyboard.press('m')  # rectangle
            await rec.hold(0.4)
            await drag(rec, (X(0.06), Y(0.08)), (X(0.26), Y(0.32)))
            await rec.hold(0.5)
            await pg.keyboard.press('o')  # ellipse
            await rec.hold(0.4)
            await drag(rec, (X(0.32), Y(0.1)), (X(0.48), Y(0.34)))
            await rec.hold(0.5)
            await pg.keyboard.press('n')  # pencil
            await rec.hold(0.4)
            pts = [(X(0.06 + 0.42 * i / 30), Y(0.5 + 0.08 * __import__('math').sin(i / 30 * 3 * 3.1416))) for i in range(31)]
            await pg.mouse.move(*pts[0])
            await pg.mouse.down()
            for q in pts[1:]:
                await pg.mouse.move(*q)
                await rec.frame(1)
            await pg.mouse.up()
            await rec.hold(1)
            for _ in range(3):
                await pg.keyboard.press('Control+z')
                await rec.hold(0.4)
            await pg.keyboard.press('Escape')
            await pg.keyboard.press('v')
            await E('hi.select(null)')
            await rec.hold(0.6)
            await rec.end()

        if want('filters'):
            # add a drop shadow to the blob, then push its Y and Blur up live with the arrow keys; undo back
            await E(pick('Blob'))
            await E('hi.setTime(2.9)')
            await E("(()=>{const h=[...document.querySelectorAll('#insp .sec > h3')].find(h=>h.childNodes[0].textContent.trim()==='Filters');h&&h.scrollIntoView({block:'start'})})()")
            await pg.wait_for_timeout(400)
            rec = await Rec(pg, 'filters' + sfx, EDITOR_R, poster=0.62).begin()
            await rec.hold(0.7)
            await pg.click('#fx-add')
            await rec.hold(0.6)
            await pg.locator('#fxMenu').get_by_text('Drop shadow', exact=True).first.click()
            await rec.hold(0.7)
            for f, keys in [('dy', ['Shift+ArrowUp'] * 2), ('dx', ['Shift+ArrowUp'] * 1), ('sd', ['Shift+ArrowUp'] * 2)]:
                await pg.locator(f'#insp input[data-f$=".{f}"]').last.click()
                await rec.hold(0.3)
                for k in keys:
                    await pg.keyboard.press(k)
                    await rec.hold(0.3)
                await rec.hold(0.3)
            await pg.keyboard.press('Escape')
            await rec.hold(1.2)
            for _ in range(4):
                await pg.keyboard.press('Control+z')
                await rec.hold(0.2)
            await rec.hold(0.5)
            await rec.end()

        if want('multi'):
            # two layers in one transform box: scale them together, turn them, and undo
            await E(pick('Blob', 'Title'))
            await E('hi.setTime(2.9)')
            await pg.wait_for_timeout(400)
            hs = await E("[...document.querySelectorAll('#overlay .ov-h')].map(e=>{const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})")
            se, rot = hs[4], hs[8]
            rec = await Rec(pg, 'multi' + sfx, EDITOR_R, poster=0.35).begin()
            await rec.hold(0.6)
            await drag(rec, se, (se[0] + 60, se[1] + 40), 16)
            await rec.hold(0.4)
            hs = await E("[...document.querySelectorAll('#overlay .ov-h')].map(e=>{const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})")
            rot = hs[8]
            await drag(rec, rot, (rot[0] + 90, rot[1] + 30), 16)
            await rec.hold(0.6)
            for _ in range(2):
                await pg.keyboard.press('Control+z')
                await rec.hold(0.5)
            await rec.hold(0.3)
            await rec.end()

        if want('presets'):
            await E(pick('Title'))
            await pg.wait_for_timeout(200)
            await pg.click('#lAnim')
            await pg.wait_for_timeout(250)
            await pg.click('#animMenu [data-presets]')
            await pg.wait_for_timeout(1000)
            await pg.click('[data-pgroup=emph]')
            await pg.wait_for_timeout(500)
            rec = await Rec(pg, 'presets' + sfx, '#presetPop', poster=0.2).begin()
            await rec.hold(2)
            for g in ['enter', 'exit', 'emph']:
                await pg.click(f'[data-pgroup={g}]')
                await rec.hold(1.6)
            await rec.end()
            await pg.keyboard.press('Escape')
            await pg.wait_for_timeout(300)

        if want('easing'):
            await E(f"(()=>{{const a={ALL};const bl=a.find(l=>l.name==='Blob');hi.select(bl.id);st.S.keys.add(bl.t[Object.keys(bl.t)[0]][0]);hi.setTime(0)}})()")
            await E("(async()=>{(await import('/src/ui/inspector.ts')).renderInspector()})()")
            await pg.wait_for_timeout(250)
            await pg.click('#tEase')
            await pg.wait_for_timeout(300)
            await pg.click('#ezPop button:text-is("Out")')
            await pg.click('#ezGrid .ezb:has(span:text-is("Back"))')
            await pg.wait_for_timeout(300)
            rec = await Rec(pg, 'easing' + sfx, '#ezPop', poster=0).begin()
            await rec.hold(1)
            for n in ['Ease', 'Cubic', 'Expo', 'Elastic', 'Bounce', 'Back']:
                await pg.click(f'#ezGrid .ezb:has(span:text-is("{n}"))')
                await rec.hold(0.9)
            await rec.end()
            await pg.keyboard.press('Escape')
        await c.close()

    # ---------- import: an animated SVG dropped on an empty canvas comes in as layers and keyframes, and plays ----------
    if want('import'):
        c, pg = await page(b, theme)
        E = pg.evaluate
        await E("(async()=>{(await import('/src/io/open.ts')).applyProject(st.blankDoc(640,400),{},null)})()")
        await pg.wait_for_timeout(1000)
        svg = open(os.path.join(ROOT, 'site/clips/night-flight.svg')).read()
        rec = await Rec(pg, 'import' + sfx, {'x': 0, 'y': 0, 'width': 1440, 'height': 900}, maxw=1600, poster=0.8, wait=40).begin()
        await rec.hold(1.0)
        await E(
            """(svg)=>{const w=document.getElementById('wrap'),r=document.getElementById('artboard').getBoundingClientRect(),
            dt=new DataTransfer();dt.items.add(new File([svg],'night-flight.svg',{type:'image/svg+xml'}));
            const o={bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.x+r.width/2,clientY:r.y+r.height/2};
            w.dispatchEvent(new DragEvent('dragover',o));w.dispatchEvent(new DragEvent('drop',o))}""",
            svg,
        )
        for _ in range(100):
            await rec.frame(1, 80)
            if await E('st.doc.layers.length>0'):
                break
        await E('hi.select(null)')
        await rec.hold(1.4)
        await E('hi.setTime(0)')
        await pg.keyboard.press('Space')
        await rec.hold(3.0)
        await pg.keyboard.press('Space')
        await rec.hold(0.6)
        await rec.end()
        await c.close()

    # ---------- the graph editor: a bone's rotation curve, with the playhead running ----------
    if want('graph'):
        c, pg = await page(b, theme, tl=420)
        E = pg.evaluate
        await pg.click('#tGraph')
        await E(f"(async()=>{{const a={ALL};const l=a.find(l=>l.name==='Stem 3');hi.select(l.id);(await import('/src/ui/graph.ts')).setGraphTrack(l.id,'rot');hi.setTime(0)}})()")
        await pg.wait_for_timeout(500)
        rec = await Rec(pg, 'graph' + sfx, '.panel.tl').begin()
        await pg.keyboard.press('Space')
        await rec.hold(3.0)
        await rec.end()
        await c.close()

    # ---------- export ----------
    names = ['x-svg', 'x-image', 'x-video', 'x-gif', 'x-scroll']
    if any(want(n) for n in names):
        c, pg = await page(b, theme)
        E = pg.evaluate
        await E('(st.S.keys.clear(),hi.select(null),hi.setTime(0))')
        await pg.click('#bExport')
        await pg.wait_for_timeout(1500)
        DLG = '#mExport .xdlg'

        if want('x-svg'):
            await pg.click('#xKind [data-v="svg"]')
            await pg.wait_for_timeout(1200)
            rec = await Rec(pg, 'x-svg' + sfx, DLG, poster=0.8).begin()
            await rec.hold(3)
            await rec.end()

        if want('x-image'):
            await E('hi.setTime(2.2)')
            await pg.click('#xKind [data-v="image"]')
            await pg.wait_for_timeout(3000)
            rec = await Rec(pg, 'x-image' + sfx, DLG, poster=0.9, wait=60).begin()
            await rec.hold(0.8)
            for f in ['webp', 'avif', 'png']:
                await pg.click(f'#xiFmt [data-v="{f}"]')
                await rec.hold(1.2, 120)
            for _ in range(8):
                await pg.click('#xiNextF')
                await rec.hold(0.25, 120)
            await rec.hold(0.8, 120)
            await rec.end()

        async def scrub(name, kind, rng, split=False, poster=0.8, sec=3.0):
            await pg.click(f'#xKind [data-v="{kind}"]')
            await pg.wait_for_timeout(8000 if kind == 'anim' else 3000)
            rec = await Rec(pg, name + sfx, DLG, poster=poster, wait=80).begin()
            n = round(sec * FPS)
            for i in range(n):
                t = i / (n - 1)
                js = f"(()=>{{const s=document.getElementById('{rng}');s.value=s.min*1+(s.max-s.min)*{t};s.dispatchEvent(new Event('input',{{bubbles:true}}))"
                if split:
                    js += f";const d=document.getElementById('xaSplit');d.value=50+38*Math.sin({t}*Math.PI*2);d.dispatchEvent(new Event('input',{{bubbles:true}}))"
                await E(js + '})()')
                await rec.frame(1)
            await rec.end()

        if want('x-video'):
            await scrub('x-video', 'video', 'xvScrub')
        if want('x-gif'):
            await scrub('x-gif', 'anim', 'xaScrub', split=True)

        if want('x-scroll'):
            await pg.click('#xKind [data-v="svg"]')
            await pg.wait_for_timeout(600)
            await pg.select_option('#xTrig', 'scrub')
            await pg.wait_for_timeout(1500)
            rec = await Rec(pg, 'x-scroll' + sfx, DLG, poster=0.3, wait=30).begin()
            await rec.hold(0.6)
            n = 5 * FPS
            for i in range(n):
                t = i / (n - 1)
                f = (1 - __import__('math').cos(t * 2 * __import__('math').pi)) / 2
                await E(f"(()=>{{const p=document.getElementById('xsPage');if(p)p.scrollTop=(p.scrollHeight-p.clientHeight)*{f}}})()")
                await rec.frame(1)
            await rec.hold(0.4)
            await rec.end()
        await c.close()


HELP_W, HELP_H, HELP_OUT, HELP_MIN = 1280, 800, 880, 560
FONTS = os.path.join(tempfile.gettempdir(), 'svgcinema-fontsource')


async def fontsource(route):
    """Web fonts come from jsDelivr (render/fonts): where that host can't be reached (a sandbox that only reaches
    the package registry), the same @fontsource files are served from the npm package."""
    u = route.request.url.split('/npm/', 1)[1].split('?')[0]
    pkg, path = u.split('/files/', 1)
    name, ver = pkg.rsplit('@', 1)
    d = os.path.join(FONTS, pkg.replace('/', '_'))
    if not os.path.isdir(d):
        os.makedirs(d, exist_ok=True)
        out = subprocess.run(['npm', 'pack', f'{name}@{ver}', '--pack-destination', d, '--silent'], capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1]
        subprocess.run(['tar', 'xzf', os.path.join(d, out), '-C', d], check=True)
    f = os.path.join(d, 'package', 'files', path)
    if not os.path.exists(f):
        return await route.abort()
    ct = 'font/woff2' if f.endswith('.woff2') else 'font/woff' if f.endswith('.woff') else 'font/ttf'
    await route.fulfill(status=200, body=open(f, 'rb').read(), headers={'content-type': ct, **CORS})


def crop_box(r):
    """A step clip's crop (CSS px): what the step showed (the lit control, where the pointer went, what the step
    says its clip must show) with some room, at 16:10 like the editor's window, at least HELP_MIN wide."""
    if not r:
        return (0, 0, HELP_W, HELP_H)
    pad = 18
    x0, y0 = r['x'] - pad, r['y'] - pad
    x1, y1 = r['x'] + r['width'] + pad, r['y'] + r['height'] + pad
    w = max(x1 - x0, HELP_MIN, (y1 - y0) * 1.6)
    h = w / 1.6
    if w >= HELP_W * 0.9 or h >= HELP_H * 0.9:
        return (0, 0, HELP_W, HELP_H)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    x = min(max(0, cx - w / 2), HELP_W - w)
    y = min(max(0, cy - h / 2), HELP_H - h)
    return (round(x), round(y), round(w), round(h))


class HelpRec(Rec):
    """A help step's clip: whole frames at 2x go to disk as they come, and end() crops them to the step's region
    (set .crop before end) and scales them to HELP_OUT wide."""

    async def begin(self):
        self.dir = tempfile.mkdtemp()
        self.n = 0
        self.crop = None
        await self.tick(0)
        return self

    async def frame(self, n=1, wait=None):
        for _ in range(n):
            await self.tick(1000 / FPS)
            await self.pg.screenshot(path=f'{self.dir}/{self.n:05d}.jpg', type='jpeg', quality=94, scale='device')
            self.n += 1

    async def end(self):
        x, y, w, h = [v * 2 for v in (self.crop or (0, 0, HELP_W, HELP_H))]
        vf = f'crop={w}:{h}:{x}:{y},scale={HELP_OUT}:-2:flags=lanczos'
        mp4 = os.path.join(self.out, self.name + '.mp4')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', f'{self.dir}/%05d.jpg', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4], check=True)
        k = min(self.n - 1, int(self.poster * self.n))
        p = os.path.join(self.out, self.name + '.webp')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{self.dir}/{k:05d}.jpg', '-vf', vf, '-q:v', '84', p], check=True)
        shutil.rmtree(self.dir)
        print(f'{os.path.relpath(mp4, ROOT)} {self.n / FPS:.1f}s crop {self.crop} {os.path.getsize(mp4) // 1024} KB, poster {os.path.getsize(p) // 1024} KB')


# The design agent's help topics (agent-*): Playwright answers the model providers with canned replies (the same as
# tests/browser/help.py), so no step reaches a real provider and none needs the network. The lists read live
# (models, prices) answer 404, so the built-in ones show; the Test, a picture and two requests are scripted.
PROVIDERS = re.compile(r'^https://(openrouter\.ai|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.groq\.com)/')


def ag_balloon():
    im = Image.new('RGB', (240, 300), (0, 255, 0))
    d = ImageDraw.Draw(im)
    d.ellipse((30, 10, 210, 200), fill=(226, 82, 64))
    d.ellipse((85, 10, 155, 200), fill=(250, 232, 206))
    d.polygon([(92, 180), (148, 180), (134, 236), (106, 236)], fill=(226, 82, 64))
    d.rectangle((104, 236, 136, 266), fill=(150, 100, 58))
    b = io.BytesIO()
    im.save(b, 'PNG')
    return base64.b64encode(b.getvalue()).decode()


AG_KITE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 210"><path id="Tail" d="M60 130c-16 14 16 26 0 40s16 26 0 36" fill="none" stroke="#ffd36e" stroke-width="4" stroke-linecap="round"/><path id="Body" d="M60 0l50 60-50 70-50-70z" fill="#ff7a59"/><path id="Spars" d="M60 0v130M10 60h100" fill="none" stroke="#7a2e1d" stroke-width="3"/></svg>'


def agent_route(pg):
    png = ag_balloon()

    async def route(r):
        q = r.request
        u = q.url
        if q.method == 'OPTIONS':
            return await r.fulfill(status=204, headers=CORS)
        if q.method != 'POST':
            return await r.fulfill(status=404, headers=CORS, body='')
        js = {**CORS, 'content-type': 'application/json'}
        sse = {**CORS, 'content-type': 'text/event-stream'}
        if u.endswith('/api/v1/images'):
            await asyncio.sleep(1.5)  # the model at work: the "Generating" card shows meanwhile
            return await r.fulfill(status=200, headers=js, body=json.dumps({'data': [{'b64_json': png, 'media_type': 'image/png'}]}))
        if not u.endswith('/chat/completions'):
            return await r.fulfill(status=404, headers=CORS, body='')
        body = json.loads(q.post_data)
        msgs = body['messages']
        offered = [t['function']['name'] for t in body.get('tools', [])]
        await asyncio.sleep(0.8)
        if 'ping' in offered:
            return await r.fulfill(status=200, headers=sse, body=oai(None, [('ping', {})]))
        if not offered:
            return await r.fulfill(status=200, headers=sse, body=oai('Red.'))
        last = [i for i, m in enumerate(msgs) if m['role'] == 'user'][-1]
        user = json.dumps(msgs[last]['content'])
        done = [m for m in msgs[last:] if m['role'] == 'tool']
        if 'balloon' in user:
            if not done:
                out = oai('I’ll paint the balloon.', [('generate_image', {'prompt': 'A hot-air balloon with red and cream stripes, soft watercolour', 'name': 'Balloon'})])
            elif len(done) == 1:
                res = json.loads(done[0]['content'])
                out = oai(None, [('place_image', {'asset': res['asset'], 'name': 'Balloon', 'x': 330, 'y': 150, 'width': 120})]) if 'asset' in res else oai('All right, no picture.')
            else:
                out = oai('Done: the balloon is in the sky.')
        elif 'kite' in user:
            if not done:
                out = oai('I’ll draw the kite as vector, so its tail can move on its own.', [('import_svg', {'svg': AG_KITE, 'name': 'Kite', 'x': 140, 'y': 140})])
            elif len(done) == 1:
                tail = await pg.evaluate("(async()=>{const s=await import('/src/core/state.ts');const l=s.doc.layers.find(l=>l.name==='Tail');return l?l.id:''})()")
                out = oai(None, [('apply_preset', {'preset': 'swing', 'ids': [tail], 'at': 0, 'length': 3})])
            else:
                out = oai('Done: the kite is vector layers, and its tail swings.')
        else:
            out = oai('Done.')
        await r.fulfill(status=200, headers=sse, body=out)

    return route


async def help_clips(b, theme):
    """public/help/<topic>-<step>[-dark].mp4/.webp: each step of each help topic, done by its Show me in the
    topic's practice scene (?tour=<topic>&clip=1: no tour card, and the tour waits for next()), cropped to the part
    of the editor the step uses (help/practice region()). Steps marked "clip": false (done outside the editor)
    have none. In the light run, public/help/<topic>.svg too, for a topic with a goal: the finished scene
    exported as CSS-animated SVG (the topic page's "What you'll make")."""
    sfx = '' if theme == 'light' else '-dark'
    os.makedirs(HELP, exist_ok=True)
    topics = json.load(open(os.path.join(ROOT, 'src/help/content.json')))['topics']
    for t in topics:
        if not t.get('ready') or not (want('help') or want('help:' + t['id'])):
            continue
        if not any(s.get('clip', True) for s in t['steps']):
            continue
        c = await b.new_context(viewport={'width': HELP_W, 'height': HELP_H}, device_scale_factor=2, permissions=['clipboard-read', 'clipboard-write'])
        await c.route('https://cdn.jsdelivr.net/npm/@fontsource/**', fontsource)
        pg = await c.new_page()
        pg.set_default_timeout(10000)
        if t['id'].startswith('agent-'):
            await pg.route(PROVIDERS, agent_route(pg))
            # Copy (the assistant's starting message) shows "Copied." as it does for a person
            await c.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE.rstrip('/'))
        await pg.add_init_script(CLOCK)
        await pg.add_init_script(f"localStorage.setItem('svgcinema:theme','{theme}');")
        await pg.goto(BASE + f"?tour={t['id']}&clip=1")
        await pg.wait_for_function('window.cinTour', timeout=30000)
        await pg.wait_for_timeout(1500)
        # (a fresh dev server may reload the page once while it prepares its dependencies)
        await pg.wait_for_function('window.cinTour', timeout=30000)
        n = len(t['steps'])
        for i in range(n):
            step = t['steps'][i]
            play = step['title'].startswith('Play')
            if step.get('clip', True):
                rec = await HelpRec(pg, f"{t['id']}-{i + 1}{sfx}", None, poster=0.97, out=HELP).begin()
                await rec.hold(0.4)
                await pg.evaluate('()=>{cinTour.show()}')
                for _ in range(FPS * 15):
                    await rec.frame(1)
                    if not (await pg.evaluate('cinTour.state().showing')):
                        break
                await rec.hold(2.2 if play else 0.8)
                await pg.evaluate('cinTour.sample()')
                rec.crop = crop_box(await pg.evaluate('cinTour.region()'))
                await rec.end()
            else:
                await pg.evaluate('()=>cinTour.show()')
                await pg.wait_for_function('!cinTour.state().showing')
            st = await pg.evaluate('cinTour.state()')
            if not (st['done'][i] if i < len(st['done']) else False):
                raise RuntimeError(f"help clip {t['id']} step {i + 1}: Show me didn't finish the step")
            if i < n - 1:
                await pg.evaluate('()=>cinTour.next()')
                await Rec(pg, '', None).tick(300)
        if theme == 'light' and t.get('goal'):
            svg = await pg.evaluate("""async()=>{const st=await import('/src/core/state.ts');const b=await import('/src/export/build.ts');
              Object.assign(st.doc.ex,{mode:'css',trigger:'load',size:'resp',prefix:'help'});return b.buildExport(null).code}""")
            open(os.path.join(HELP, t['id'] + '.svg'), 'w').write(svg)
            print(f"public/help/{t['id']}.svg {len(svg) // 1024} KB")
        await c.close()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for theme in THEMES:
            if not ARGS or [a for a in ARGS if a != 'help' and not a.startswith('help:')]:
                await clips(b, theme)
            await help_clips(b, theme)
        await b.close()


asyncio.run(main())
