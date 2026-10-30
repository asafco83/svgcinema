import asyncio, sys, json, os, re, base64, io
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Help & tutorials (ui/help-panel, help/practice, help/tours):
# - every practice scene keeps a new project's length, repeat and direction (what the steps make there is what
#   they make anywhere);
# - every guided tour runs to the end in its practice editor with "Show me" alone (a change to the editor that
#   breaks a step fails here), and the practice editor keeps nothing: the saved project, its file and the
#   settings in the browser are as they were;
# - the practice editor's top bar: Practice, the tutorial, Exit; no theme button, and the ☰ menu and the Agent
#   button only for a scene that uses them (Scene.menu, Scene.agent);
# - in the editor: ☰ › Help › Help & tutorials and Shift+F1 open the Help panel (F1 is still the shortcuts),
#   the hub lists the topics with a page, a topic shows its steps and clips, Start guided tour opens the
#   practice editor beside the panel, the panel follows the tour, the keys don't reach the project
#   underneath, and Exit brings the project back untouched; the Agent and the Help panel share the dock.
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HELP=json.load(open(os.path.join(ROOT,'src/help/content.json')))
READY=[t for t in HELP['topics'] if t.get('ready')]
TOURS=[t for t in READY if t.get('tour')]
# every topic with a page runs its steps with Show me (the clips are recordings of it), tour or not
SHOWN=READY if not os.environ.get('HELP_ONLY') else [t for t in READY if t['id'] in os.environ['HELP_ONLY'].split(',')]

# The design agent's topics (agent-*): Playwright answers the model providers with canned replies (as in
# tests/browser/agent-*.py), so no step reaches a real provider and none needs the network. The lists read live
# (models, prices) answer 404, so the built-in ones are used; the Test, a picture and two requests are scripted.
PROVIDERS=re.compile(r'^https://(openrouter\.ai|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.groq\.com)/')
AG_CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, POST, OPTIONS'}
def ag_oai(text=None, tools=None):
    s=''
    if text: s+='data: '+json.dumps({'choices':[{'index':0,'delta':{'content':text}}]})+'\n\n'
    for n,(name,args) in enumerate(tools or []):
        s+='data: '+json.dumps({'choices':[{'index':0,'delta':{'tool_calls':[{'index':n,'id':f'c{n}','function':{'name':name,'arguments':json.dumps(args)}}]}}]})+'\n\n'
    s+='data: '+json.dumps({'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if tools else 'stop'}]})+'\n\n'
    return s+'data: [DONE]\n\n'
def ag_balloon():
    im=Image.new('RGB',(240,300),(0,255,0)); d=ImageDraw.Draw(im)
    d.ellipse((30,10,210,200),fill=(226,82,64)); d.ellipse((85,10,155,200),fill=(250,232,206))
    d.line((80,190,104,250),fill=(90,60,40),width=3); d.line((160,190,136,250),fill=(90,60,40),width=3)
    d.rectangle((100,248,140,280),fill=(150,100,58))
    b=io.BytesIO(); im.save(b,'PNG'); return base64.b64encode(b.getvalue()).decode()
AG_PNG=ag_balloon()
AG_KITE='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 210"><path id="Tail" d="M60 130c-16 14 16 26 0 40s16 26 0 36" fill="none" stroke="#ffd36e" stroke-width="4" stroke-linecap="round"/><path id="Body" d="M60 0l50 60-50 70-50-70z" fill="#ff7a59"/><path id="Spars" d="M60 0v130M10 60h100" fill="none" stroke="#7a2e1d" stroke-width="3"/></svg>'
def agent_route(pg):
    async def route(r):
        q=r.request; u=q.url
        if q.method=='OPTIONS': return await r.fulfill(status=204,headers=AG_CORS)
        if q.method!='POST': return await r.fulfill(status=404,headers=AG_CORS,body='')
        js={**AG_CORS,'content-type':'application/json'}; sse={**AG_CORS,'content-type':'text/event-stream'}
        if u.endswith('/api/v1/images'):
            return await r.fulfill(status=200,headers=js,body=json.dumps({'data':[{'b64_json':AG_PNG,'media_type':'image/png'}]}))
        if not u.endswith('/chat/completions'): return await r.fulfill(status=404,headers=AG_CORS,body='')
        body=json.loads(q.post_data); msgs=body['messages']; offered=[t['function']['name'] for t in body.get('tools',[])]
        if 'ping' in offered: return await r.fulfill(status=200,headers=sse,body=ag_oai(None,[('ping',{})]))
        if not offered: return await r.fulfill(status=200,headers=sse,body=ag_oai('Red.'))
        last=[i for i,m in enumerate(msgs) if m['role']=='user'][-1]
        user=json.dumps(msgs[last]['content']); done=[m for m in msgs[last:] if m['role']=='tool']
        if 'balloon' in user:
            if not done: out=ag_oai('I’ll paint the balloon.',[('generate_image',{'prompt':'A hot-air balloon with red and cream stripes, soft watercolour','name':'Balloon'})])
            elif len(done)==1:
                res=json.loads(done[0]['content'])
                out=ag_oai(None,[('place_image',{'asset':res['asset'],'name':'Balloon','x':330,'y':150,'width':120})]) if 'asset' in res else ag_oai('All right, no picture.')
            else: out=ag_oai('Done: the balloon is in the sky.')
        elif 'kite' in user:
            if not done: out=ag_oai('I’ll draw the kite as vector, so its tail can move on its own.',[('import_svg',{'svg':AG_KITE,'name':'Kite','x':140,'y':140})])
            elif len(done)==1:
                tail=await pg.evaluate("(async()=>{const s=await import('/src/core/state.ts');const l=s.doc.layers.find(l=>l.name==='Tail');return l?l.id:''})()")
                out=ag_oai(None,[('apply_preset',{'preset':'swing','ids':[tail],'at':0,'length':3})])
            else: out=ag_oai('Done: the kite is vector layers, and its tail swings.')
        else: out=ag_oai('Done.')
        await r.fulfill(status=200,headers=sse,body=out)
    return route
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
        for t in SHOWN:
            ag=t['id'].startswith('agent-')
            if ag: await pg.route(PROVIDERS, agent_route(pg))
            await pg.goto(base+f"?tour={t['id']}"); await pg.wait_for_function('window.cinTour', timeout=10000)
            st=await pg.evaluate('cinTour.state()')
            check(f"{t['id']}: the tour starts at step 1 of {len(t['steps'])}", st['i']==0 and st['n']==len(t['steps']), st)
            names=await pg.evaluate("(async()=>{const s=await import('/src/core/state.ts');return [s.doc.name,s.doc.layers.length]})()")
            check(f"{t['id']}: its own small practice scene", names[0].startswith('Practice') and names[1]<=12, names)
            # the animation's settings are a new project's (so the steps give the same result in any project)
            d=await pg.evaluate("(async()=>{const s=await import('/src/core/state.ts');const b=s.blankDoc(640,400);return [[s.doc.dur,s.doc.it,s.doc.dir],[b.dur,b.it,b.dir]]})()")
            check(f"{t['id']}: length, repeat and direction are a new project's defaults", d[0]==d[1], d)
            ok=True
            for i in range(len(t['steps'])):
                await pg.evaluate('cinTour.show()')
                for _ in range(30):
                    await pg.wait_for_timeout(150)
                    st=await pg.evaluate('cinTour.state()')
                    if st['i']>i or st['finished']: break
                if not (st['i']>i or st['finished']):
                    ok=False; check(f"{t['id']}: Show me does step {i+1} ({t['steps'][i]['title']})", False, st); break
            check(f"{t['id']}: Show me alone runs every step", ok and st['finished'], st)
            await pg.screenshot(path=OUT+f"help-tour-{t['id']}.png")
            # the top bar: Practice, the tutorial and Exit; the ☰ menu and the Agent button only for a scene that asks
            bar=await pg.evaluate("(async()=>{const m=await import('/src/help/scenes.ts'),sc=m.SCENES[%s];return [['#bMenu','#bAgent','#bTheme'].map(s=>getComputedStyle(document.querySelector(s)).display!=='none'), [!!sc.menu,!!sc.agent,false], document.querySelector('.pr-chip')?.textContent, document.querySelector('.pr-name')?.textContent, !!document.getElementById('prExit')]})()" % json.dumps(t['id']))
            check(f"{t['id']}: the practice editor's top bar: Practice, the tutorial and Exit, no theme, the menu and Agent only when the scene uses them", bar[0]==bar[1] and bar[2]=='Practice' and bar[3]==t['title'] and bar[4], bar)
            if ag: await pg.unroute(PROVIDERS)
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
