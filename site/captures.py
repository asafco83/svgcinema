# SVGcinema — the website's pictures of the editor
# Every picture of the editor's UI on the website is a capture of the running editor, never redrawn by hand.
# This script makes them all, in the light and the dark theme, as WebP at 2× in site/img/.
# Run it after a UI change that shows in them, with the dev server on port 5199 (npx vite --port 5199):
#   python3 site/captures.py [http://localhost:5199/]
# Needs Playwright for Python (Chromium) and Pillow. The design agent's turns are scripted: Playwright answers
# OpenRouter's URL with canned streams (as in tests/browser/agent-*.py), so no model or key is used.
import asyncio, io, json, os, sys
from PIL import Image
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'site/img')
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5199/'
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS'}
ALL = "(()=>{const all=[];const w=a=>a.forEach(l=>{all.push(l);if(l.ch)w(l.ch)});w(st.doc.layers);return all})()"
os.makedirs(IMG, exist_ok=True)


def oai(text=None, tools=None):
    s = ''
    if text:
        s += 'data: ' + json.dumps({'choices': [{'index': 0, 'delta': {'content': text}}]}) + '\n\n'
    for n, (name, args) in enumerate(tools or []):
        s += 'data: ' + json.dumps({'choices': [{'index': 0, 'delta': {'tool_calls': [{'index': n, 'id': f'c{n}', 'function': {'name': name, 'arguments': json.dumps(args)}}]}}]}) + '\n\n'
    s += 'data: ' + json.dumps({'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'tool_calls' if tools else 'stop'}]}) + '\n\n'
    return s + 'data: [DONE]\n\n'


def save(png, name, crop=None, collapse=False):
    """Writes site/img/<name>.webp from a PNG screenshot (bytes), optionally cropped (in 2× pixels) and with
    long runs of empty rows (an agent panel's blank chat area) squeezed out."""
    im = Image.open(io.BytesIO(png)).convert('RGB')
    if crop:
        im = im.crop(crop)
    if collapse:
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
        out = Image.new('RGB', (w, len(rows)))
        for i, yy in enumerate(rows):
            out.paste(im.crop((0, yy, w, yy + 1)), (0, i))
        im = out
    path = os.path.join(IMG, name + '.webp')
    im.save(path, 'WEBP', quality=86, method=6)
    print(f'site/img/{name}.webp {im.size[0]}×{im.size[1]} {os.path.getsize(path) // 1024} KB')


async def page(b, theme, settings=None, route=None):
    c = await b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=2)
    pg = await c.new_page()
    pg.set_default_timeout(8000)
    if route:
        await pg.route('https://openrouter.ai/**', route)
    init = f"localStorage.setItem('svgcinema:theme','{theme}');"
    if settings:
        init += "localStorage.setItem('svgcinema:agent.keys', JSON.stringify({openrouter:'test-key'}));"
        init += f"localStorage.setItem('svgcinema:agent.settings', {json.dumps(json.dumps(settings))});"
    await pg.add_init_script(init)
    await pg.goto(BASE)
    await pg.wait_for_timeout(2500)
    await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); }")
    return c, pg


async def shots(b, theme):
    sfx = '' if theme == 'light' else '-dark'
    key = {'provider': 'openrouter', 'model': 'anthropic/claude-sonnet-5.5', 'connect': 'key'}

    # 1. the agent after a request: the sun breathes, the title pops in (one undo step)
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
        if not tools:
            out = oai('I’ll give the sun a slow breathe and pop the title in once the sun is up.', [('apply_preset', {'preset': 'breathe', 'ids': [ids['sun']], 'at': 0})])
        elif len(tools) == 1:
            out = oai(None, [('apply_preset', {'preset': 'pop-in', 'ids': [ids['title']], 'at': 2})])
        else:
            out = oai('Done. The sun breathes over the whole loop, and the title pops in at 2 s, after the sun has cleared the hills. Want the rays to turn faster too?')
        await r.fulfill(status=200, headers={**CORS, 'content-type': 'text/event-stream'}, body=out)

    c, pg = await page(b, theme, key, chat)
    await pg.click('#bAgent')
    await pg.wait_for_timeout(400)
    await pg.fill('#agText', 'Make the sun breathe and pop the title in after it rises')
    await pg.press('#agText', 'Enter')
    await pg.wait_for_timeout(2500)
    await pg.evaluate(f"(()=>{{const a={ALL};hi.select(a.find(l=>l.name==='Sun').id);hi.setTime(2.4)}})()")
    await pg.wait_for_timeout(400)
    save(await pg.locator('#agent').screenshot(), 'agent-chat' + sfx, collapse=True)
    await c.close()

    # 2. the agent's first screen: how to connect
    c, pg = await page(b, theme)
    await pg.click('#bAgent')
    await pg.wait_for_timeout(500)
    save(await pg.locator('#agent').screenshot(), 'agent-connect' + sfx, collapse=True)
    await c.close()

    # 3. the agent's cards: Vector or image? and Generate 1 image?
    async def cards(r):
        q = r.request
        if q.method == 'OPTIONS':
            return await r.fulfill(status=204, headers=CORS)
        if q.method == 'GET':
            return await r.fulfill(status=404, headers=CORS, body='')
        msgs = json.loads(q.post_data)['messages']
        last = [i for i, m in enumerate(msgs) if m['role'] == 'user'][-1]
        user = msgs[last]['content'] if isinstance(msgs[last]['content'], str) else json.dumps(msgs[last]['content'])
        if any(m['role'] == 'tool' for m in msgs[last:]):
            out = oai('Stopped.')
        elif 'moon' in user:
            out = oai(None, [('generate_image', {'prompt': 'a watercolour moon with soft craters', 'name': 'Moon', 'either': True})])
        else:
            out = oai(None, [('generate_image', {'prompt': 'A watercolour hot-air balloon, soft paper texture', 'name': 'Balloon'})])
        await r.fulfill(status=200, headers={**CORS, 'content-type': 'text/event-stream'}, body=out)

    img = {**key, 'preferVector': False, 'vector': 'agent', 'imgProvider': 'openrouter', 'transparent': True}
    for ask, sel, name in [('Add a moon to the sky', '.ag-kind', 'agent-kind'), ('Paint a hot-air balloon picture', '.ag-imgask', 'agent-image')]:
        c, pg = await page(b, theme, img, cards)
        await pg.click('#bAgent')
        await pg.wait_for_timeout(400)
        await pg.fill('#agText', ask)
        await pg.press('#agText', 'Enter')
        await pg.wait_for_selector(sel, timeout=8000)
        await pg.wait_for_timeout(300)
        save(await pg.locator('#agent').screenshot(), name + sfx, collapse=True)
        await c.close()

    # 4. the editor's panels on the sample scene
    c, pg = await page(b, theme)
    E = pg.evaluate
    await E("hi.setTime(2.4)")
    await pg.wait_for_timeout(300)
    save(await pg.screenshot(), 'editor-draw' + sfx, crop=(0, 104, 1607, 1224))
    await E(f"(()=>{{const a={ALL};hi.select(a.find(l=>l.name==='Sun').id)}})()")
    await pg.wait_for_timeout(300)
    t = await pg.locator('#insp .sec', has=pg.locator('h3', has_text='Transforms')).first.screenshot()
    save(t, 'inspector-tracks' + sfx)
    save(await pg.locator('.panel.tl').screenshot(), 'timeline' + sfx)
    # several layers
    await E(f"(()=>{{const a={ALL};hi.select(a.find(l=>l.name==='Blob').id);hi.select(a.find(l=>l.name==='Title').id,'toggle');hi.setTime(2.9)}})()")
    await pg.wait_for_timeout(400)
    save(await pg.screenshot(), 'editor-multi' + sfx, crop=(600, 104, 2880, 1224))
    # filters
    await E(f"(()=>{{const a={ALL};hi.select(a.find(l=>l.name==='Title').id)}})()")
    await E("(()=>{const h=[...document.querySelectorAll('#insp .sec > h3')].find(h=>h.childNodes[0].textContent.trim()==='Filters');h&&h.scrollIntoView({block:'start'})})()")
    await pg.wait_for_timeout(300)
    save(await pg.locator('#insp .sec', has=pg.locator('h3', has_text='Filters')).first.screenshot(), 'filters' + sfx)
    # presets
    await pg.click('#lAnim')
    await pg.wait_for_timeout(250)
    await pg.click('#animMenu [data-presets]')
    await pg.wait_for_timeout(1000)
    await pg.click('[data-pgroup=emph]')
    await pg.wait_for_timeout(900)
    save(await pg.locator('#presetPop').screenshot(), 'presets' + sfx)
    await pg.keyboard.press('Escape')
    await pg.wait_for_timeout(300)
    # graph
    await E(f"(()=>{{const a={ALL};hi.select(a.find(l=>l.name==='Blob').id)}})()")
    await pg.click('#tGraph')
    await pg.wait_for_timeout(600)
    save(await pg.locator('.panel.tl').screenshot(), 'graph' + sfx)
    await pg.click('#tGraph')
    await pg.wait_for_timeout(300)
    # easing
    await E(f"(()=>{{const a={ALL};const bl=a.find(l=>l.name==='Blob');hi.select(bl.id);st.S.keys.add(bl.t[Object.keys(bl.t)[0]][0]);hi.setTime(0)}})()")
    await E("(async()=>{(await import('/src/ui/inspector.ts')).renderInspector()})()")
    await pg.wait_for_timeout(250)
    await pg.click('#tEase')
    await pg.wait_for_timeout(300)
    await pg.click('#ezPop button:text-is("Out")')
    await pg.click('#ezGrid .ezb:has(span:text-is("Back"))')
    await pg.wait_for_timeout(250)
    save(await pg.locator('#ezPop').screenshot(), 'easing' + sfx)
    await pg.keyboard.press('Escape')
    await E("(st.S.keys.clear(),hi.select(null),hi.setTime(2.9))")
    await pg.wait_for_timeout(200)
    # export, every kind, and Linked to scroll
    await pg.click('#bExport')
    await pg.wait_for_timeout(1500)
    for k in ['svg', 'image', 'video', 'anim']:
        await pg.click(f'#xKind [data-v="{k}"]')
        await pg.wait_for_timeout({'svg': 800, 'image': 3000, 'video': 3000, 'anim': 8000}[k])
        save(await pg.locator('#mExport .xdlg').screenshot(), 'export-' + k + sfx)
    await pg.click('#xKind [data-v="svg"]')
    await pg.wait_for_timeout(500)
    await pg.select_option('#xTrig', 'scrub')
    await pg.wait_for_timeout(1500)
    await E("(()=>{const p=document.getElementById('xsPage');if(p)p.scrollTop=p.scrollHeight*0.35})()")
    await pg.wait_for_timeout(800)
    save(await pg.locator('#mExport .xdlg').screenshot(), 'export-scroll' + sfx)
    await c.close()


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for theme in ['light', 'dark']:
            await shots(b, theme)
        await b.close()


asyncio.run(main())
