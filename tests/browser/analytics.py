import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Anonymous usage counts (core/analytics, site.js): Umami loads on svgcinema.com only. Here the browser is told that
# svgcinema.com is the dev server, and Umami's script is a stand-in that records what would be sent:
# - anywhere else (the dev server itself) no script loads and nothing is sent;
# - on svgcinema.com the editor sends editor_open, project_new, export_open, animation_exported, feature_used…,
#   never a project's name or content; a practice editor (guided tour) loads nothing and sends nothing;
# - the website sends its events (editor link, downloads, help search, tours) and the Privacy page's email is
#   nowhere in the page until clicked.
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STUB="window.__sent=window.__sent||[];window.umami={track:function(n,d){window.__sent.push([n,d||{}])}};"
async def main():
    dev=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/'
    R={}; F=[]
    def check(n,c,i=None):
        R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
        if not c: F.append(n)
    async with async_playwright() as p:
        b=await p.chromium.launch()
        errs=[]
        # ---- not svgcinema.com: nothing
        c=await b.new_context(viewport={'width':1440,'height':900}); pg=await c.new_page()
        asked=[]
        pg.on('request', lambda r: 'umami' in r.url and asked.append(r.url))
        await pg.goto(dev); await pg.wait_for_timeout(2500)
        check('elsewhere (the dev server): no script, nothing asked for', not await pg.evaluate("!!document.querySelector('script[src*=umami]')") and asked==[], asked)
        await c.close()

        # ---- svgcinema.com (the dev server behind it)
        c=await b.new_context(viewport={'width':1440,'height':900})
        async def to_dev(route):
            u=route.request.url.replace('https://svgcinema.com/', dev)
            try:
                r=await route.fetch(url=u)
                await route.fulfill(response=r)
            except Exception:
                await route.abort()
        await c.route('https://svgcinema.com/**', to_dev)
        await c.route('https://cloud.umami.is/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=STUB))
        pg=await c.new_page(); pg.set_default_timeout(8000)
        pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto('https://svgcinema.com/'); await pg.wait_for_timeout(3500)
        ev=pg.evaluate
        s=await ev("[...document.querySelectorAll('script[src*=umami]')].map(s=>[s.dataset.websiteId,s.dataset.domains,s.dataset.doNotTrack])")
        check('svgcinema.com: the Umami script, its site id, the domains and Do Not Track', s==[['3e441baa-e061-4501-8fff-9470c140b799','svgcinema.com,www.svgcinema.com','true']], s)
        sent=lambda: ev("window.__sent||[]")
        names=lambda xs:[x[0] for x in xs]
        x=await sent()
        check('editor_open, with only categories', 'editor_open' in names(x) and all(set(d.keys())<={'returning','theme','version'} for n,d in x if n=='editor_open'), x)
        await ev("async()=>{window.st=await import('/src/core/state.ts');window.hi=await import('/src/core/history.ts')}")
        await ev("hi.setTool('pen')"); await ev("hi.setTool('pen')")
        x=await sent()
        check('feature_used, once per visit for each', [d for n,d in x if n=='feature_used'].count({'feature':'tool_pen'})==1, x)
        await ev("(()=>{const l=st.doc.layers.find(l=>l.name==='Title');hi.select(l.id)})()")
        await ev("(async()=>{const h=await import('/src/core/history.ts');const st=await import('/src/core/state.ts');const l=st.doc.layers.find(l=>l.name==='Ground');h.select(l.id);h.toggleKey(l,'skw')})()")
        x=await sent()
        check('starting a track counts the property animated', {'feature':'animate_skw'} in [d for n,d in x if n=='feature_used'], x)
        await pg.click('#bExport'); await pg.wait_for_timeout(1500)
        await pg.evaluate("document.getElementById('xDl').click()"); await pg.wait_for_timeout(1500)
        x=await sent()
        ex=[d for n,d in x if n=='animation_exported']
        check('export_open and animation_exported, with its kind and settings', 'export_open' in names(x) and len(ex)==1 and ex[0].get('kind')=='svg' and ex[0].get('format')=='svg' and ex[0].get('method')=='download' and 'layers' in ex[0], ex)
        name=await ev("st.doc.name")
        check('no event carries the project\'s name or content', name not in json.dumps(x) and 'Title' not in json.dumps(x), name)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await pg.keyboard.press('Shift+F1'); await pg.wait_for_timeout(400)
        await pg.click('#help [data-topic="keyframes"]'); await pg.wait_for_timeout(300)
        await pg.click('#help [data-tour="keyframes"]')
        await pg.wait_for_function("(()=>{const f=document.querySelector('.prac-frame');return !!(f&&f.contentWindow&&f.contentWindow.cinTour)})()", timeout=10000)
        await pg.wait_for_timeout(800)
        fr=[f for f in pg.frames if 'tour=keyframes' in f.url][0]
        check('a practice editor loads nothing and sends nothing', not await fr.evaluate("!!document.querySelector('script[src*=umami]')") and not await fr.evaluate("(window.__sent||[]).length"))
        await pg.click('#help [data-cmd="exit"]'); await pg.wait_for_timeout(300)
        x=await sent()
        check('help_open, help_topic, tour_start and tour_exit', all(n in names(x) for n in ['help_open','help_topic','tour_start','tour_exit']), names(x))
        await pg.click('#bMenu'); await pg.hover('#fileMenu [data-sub="help"] > button'); await pg.wait_for_timeout(300)
        await pg.click('[data-lm="hp:about"]'); await pg.wait_for_timeout(300)
        check('About says what is counted', 'counted anonymously' in await ev("document.getElementById('abPrivacy').textContent"))

        # ---- the website on svgcinema.com
        await pg.goto('https://svgcinema.com/site/downloads/index.html'); await pg.wait_for_timeout(1500)
        await ev("addEventListener('click',e=>e.preventDefault())")
        await ev("document.querySelector('a[href$=\"SVGcinema-Thumbnails-Setup.zip\"]').click()")
        await ev("document.querySelector('a[href$=\"cin-player.min.js\"]').click()")
        await ev("document.querySelector('header a[data-editor]').click()")
        x=await sent()
        check('website: thumbnails, player and editor-link events', [['thumbnails_download',{'platform':'windows'}],['player_download',{'where':'website'}],['editor_open_click',{'place':'header'}]]==x, x)
        await pg.goto('https://svgcinema.com/site/help/index.html'); await pg.wait_for_timeout(1200)
        await pg.fill('#helpQ','bounce'); await pg.wait_for_timeout(1600)
        check('website: help search (after a pause)', ['help_search',{'term':'bounce'}] in await sent(), await sent())
        await pg.goto('https://svgcinema.com/site/privacy/index.html'); await pg.wait_for_timeout(1000)
        html=await pg.content()
        check('privacy: the email is nowhere in the page', 'contact.svgcinema@gmail.com' not in html and 'gmail.com' not in html.replace('gmail (dot) com',''))
        await ev("addEventListener('click',e=>e.preventDefault(),true)")
        mail=await ev("(()=>{const a=document.querySelector('a[data-m]');a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return a.getAttribute('href')})()")
        check('privacy: Email us puts the address together when clicked', mail=='mailto:contact.svgcinema@gmail.com', mail)
        await c.close()
        await b.close()
    R['errors']=[e for e in errs if 'WebSocket' not in e and 'vite' not in e.lower()]; print(json.dumps(R,indent=1,ensure_ascii=False)); print('FAILS',F+(['errors'] if R['errors'] else []))
asyncio.run(main())
