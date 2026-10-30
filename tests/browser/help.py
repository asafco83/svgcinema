import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Help & tutorials (ui/help-panel, help/practice, help/tours):
# - every guided tour runs to the end in its practice editor with "Show me" alone (a change to the editor that
#   breaks a step fails here), and the practice editor keeps nothing: the saved project, its file and the
#   settings in the browser are as they were;
# - the practice editor's top bar: Practice, the tutorial, Exit; no menu, Agent or theme button;
# - in the editor: ☰ › Help › Help & tutorials and Shift+F1 open the Help panel (F1 is still the shortcuts),
#   the hub lists the topics with a page, a topic shows its steps and clips, Start guided tour opens the
#   practice editor beside the panel, the panel follows the tour, the keys don't reach the project
#   underneath, and Exit brings the project back untouched; the Agent and the Help panel share the dock.
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HELP=json.load(open(os.path.join(ROOT,'src/help/content.json')))
READY=[t for t in HELP['topics'] if t.get('ready')]
TOURS=[t for t in READY if t.get('tour')]
async def main():
    base=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/'
    R={}; F=[]
    def check(n,c,i=None):
        R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
        if not c: F.append(n)
    async with async_playwright() as p:
        b=await p.chromium.launch()
        errs=[]
        # ---------- every tour, with Show me alone, in its practice editor ----------
        c=await b.new_context(viewport={'width':1280,'height':800})
        pg=await c.new_page(); pg.set_default_timeout(8000)
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(base); await pg.wait_for_timeout(2000)
        # what the browser keeps for the user's own editing, before any practice
        await pg.evaluate("localStorage.setItem('svgcinema:doc', JSON.stringify({name:'Mine'})); localStorage.setItem('svgcinema:dirty','1'); localStorage.setItem('svgcinema:inspClosed','[]')")
        keep=await pg.evaluate("JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])))")
        for t in TOURS:
            await pg.goto(base+f"?tour={t['id']}"); await pg.wait_for_function('window.cinTour', timeout=10000)
            st=await pg.evaluate('cinTour.state()')
            check(f"{t['id']}: the tour starts at step 1 of {len(t['steps'])}", st['i']==0 and st['n']==len(t['steps']), st)
            names=await pg.evaluate("(async()=>{const s=await import('/src/core/state.ts');return [s.doc.name,s.doc.layers.length]})()")
            check(f"{t['id']}: its own small practice scene", names[0].startswith('Practice') and names[1]<=12, names)
            ok=True
            for i in range(len(t['steps'])):
                await pg.evaluate('cinTour.show()')
                for _ in range(30):
                    await pg.wait_for_timeout(150)
                    st=await pg.evaluate('cinTour.state()')
                    if st['i']>i or st['finished']: break
                if not (st['i']>i or st['finished']):
                    ok=False; check(f"{t['id']}: Show me does step {i+1} ({t['steps'][i]['title']})", False, st); break
            check(f"{t['id']}: Show me alone runs the whole tour", ok and st['finished'], st)
            await pg.screenshot(path=OUT+f"help-tour-{t['id']}.png")
        bar=await pg.evaluate("[['#bMenu','#bAgent','#bTheme'].map(s=>getComputedStyle(document.querySelector(s)).display), document.querySelector('.pr-chip')?.textContent, document.querySelector('.pr-name')?.textContent, !!document.getElementById('prExit')]")
        check('the practice editor\'s top bar: Practice, the tutorial and Exit, no menu, Agent or theme', bar[0]==['none','none','none'] and bar[1]=='Practice' and bar[2]==TOURS[-1]['title'] and bar[3], bar)
        await pg.goto(base); await pg.wait_for_timeout(1500)
        after=await pg.evaluate("JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])))")
        check('the practice editors kept nothing in the browser', after==keep, (keep[:200],after[:200]))
        await pg.evaluate("localStorage.removeItem('svgcinema:doc'); localStorage.removeItem('svgcinema:dirty'); localStorage.removeItem('svgcinema:inspClosed')")
        await c.close()

        # ---------- the Help panel in the editor ----------
        c=await b.new_context(viewport={'width':1440,'height':900})
        pg=await c.new_page(); pg.set_default_timeout(8000)
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(base); await pg.wait_for_timeout(2500)
        ev=pg.evaluate
        await ev("async()=>{ window.st=await import('/src/core/state.ts'); }")
        await pg.click('#bMenu'); await pg.wait_for_timeout(200)
        await pg.hover('#fileMenu [data-sub="help"] > button'); await pg.wait_for_timeout(400)
        first=await ev("(()=>{const i=[...document.querySelectorAll('[data-lm^=\"hp:\"]')];return i.map(e=>e.dataset.lm)})()")
        check('☰ › Help: Help & tutorials comes first', first[:2]==['hp:help','hp:keys'], first)
        await pg.click('[data-lm="hp:help"]'); await pg.wait_for_timeout(400)
        check('…and opens the Help panel', await ev("!document.getElementById('help').hidden && document.getElementById('app').classList.contains('help-on')"))
        rows=await ev("[...document.querySelectorAll('#help .hp-row span')].map(e=>e.textContent)")
        check('the hub lists every topic with a page', sorted(rows)==sorted(t['title'] for t in READY), rows)
        await pg.fill('#hpQ','bounce'); await pg.wait_for_timeout(200)
        hits=await ev("[...document.querySelectorAll('#help .hp-row span')].map(e=>e.textContent)")
        check('search finds a topic by its steps', hits==['Easing'], hits)
        await pg.fill('#hpQ',''); await pg.wait_for_timeout(100)
        await pg.keyboard.press('Shift+F1'); await pg.wait_for_timeout(300)
        check('Shift+F1 closes it', await ev("document.getElementById('help').hidden"))
        await pg.keyboard.press('F1'); await pg.wait_for_timeout(300)
        check('F1 is still the keyboard shortcuts', await ev("!document.getElementById('mKeys').hidden") if await ev("!!document.getElementById('mKeys')") else True)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        await pg.keyboard.press('Shift+F1'); await pg.wait_for_timeout(300)
        t=next(x for x in TOURS if x['id']=='keyframes')
        await pg.click('#help [data-topic="keyframes"]'); await pg.wait_for_timeout(300)
        steps=await ev("document.querySelectorAll('#help .hp-steps li').length")
        clips=await ev("[...document.querySelectorAll('#help video.hp-clip')].map(v=>v.getAttribute('poster'))")
        check('a topic: its steps, each with its clip', steps==len(t['steps']) and len(clips)==steps and all(os.path.exists(os.path.join(ROOT,'public',c)) for c in clips), clips)
        before=await ev("JSON.stringify(st.doc)")
        await pg.click('#help [data-tour="keyframes"]')
        await pg.wait_for_function("(()=>{const f=document.querySelector('.prac-frame');return !!(f&&f.contentWindow&&f.contentWindow.cinTour)})()", timeout=10000)
        check('Start guided tour opens a practice editor over the editor', await ev("document.querySelector('.prac-frame').src.includes('tour=keyframes&panel=1') && document.getElementById('app').classList.contains('practicing')"))
        r=await ev("(()=>{const f=document.querySelector('.prac-frame').getBoundingClientRect(),h=document.getElementById('help').getBoundingClientRect();return [Math.round(f.left),Math.round(f.right),Math.round(h.left),Math.round(h.top),Math.round(h.bottom)]})()")
        check('…left of the Help panel, which takes the full height', r[0]==0 and abs(r[1]-r[2])<=1 and r[3]==0 and r[4]==900, r)
        await pg.click('#help [data-cmd="show"]'); await pg.wait_for_timeout(2600)
        prog=await ev("document.querySelector('#help .hp-prog').textContent")
        check('the panel follows the tour (Show me from the panel)', 'Step 2' in prog and await ev("document.querySelectorAll('#help .hp-tour li.done').length")>=1, prog)
        await pg.click('#help .hp-safe'); await pg.keyboard.press('Delete'); await pg.keyboard.press('Space'); await pg.wait_for_timeout(300)
        check('while practising, keys don\'t reach the project underneath', await ev("JSON.stringify(st.doc)")==before and not await ev("st.S.playing"))
        await pg.screenshot(path=OUT+'help-practice.png')
        await pg.click('#help [data-cmd="exit"]'); await pg.wait_for_timeout(300)
        check('Exit practice: the frame goes, the project is as it was', await ev("!document.querySelector('.prac-frame') && !document.getElementById('app').classList.contains('practicing')") and await ev("JSON.stringify(st.doc)")==before)
        await pg.click('#bAgent'); await pg.wait_for_timeout(300)
        check('the Agent and the Help panel share the dock', await ev("document.getElementById('help').hidden && !document.getElementById('agent').hidden"))
        await pg.click('#bAgent'); await pg.wait_for_timeout(200)
        await c.close()
        await b.close()
    R['errors']=errs; print(json.dumps(R,indent=1,ensure_ascii=False)); print('FAILS',F+(['errors'] if errs else []))
asyncio.run(main())
