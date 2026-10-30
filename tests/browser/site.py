import asyncio, sys, json, os, re, subprocess, tempfile
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The website (site/): every page is built from the current sources, runs without errors and fits a phone; the
# home page's live hero, scroll-driven workflow and demo cards play; the quoted file sizes match the hero file;
# the Features page's tiles animate and its tool keys answer real key presses; the Export page keeps the embed
# code tabs and the image demo; the download links point at the editor's downloads folder; the help pages
# (Help & tutorials) are written from src/help/content.json, their clips are the editor's own files, and a guided
# tour opens the practice editor in a lightbox.
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HELP=json.load(open(os.path.join(ROOT,'src/help/content.json')))
READY=[t for t in HELP['topics'] if t.get('ready')]
PAGES=['','features/','agent/','import/','export/','downloads/','licence/','help/']+[f"help/{t['id']}/" for t in READY]
NAV={'':'Home','features/':'Features','agent/':'Design agent','import/':'Import','export/':'Export','downloads/':'Downloads','licence/':None,'help/':'Help',**{f"help/{t['id']}/":'Help' for t in READY}}
async def main():
    R={}; F=[]
    def check(n,c,i=None):
        R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
        if not c: F.append(n)
    # the committed pages are what the sources build to
    tmp=tempfile.mkdtemp()
    subprocess.run(['node',os.path.join(ROOT,'site/build.mjs'),'--out='+tmp],check=True,capture_output=True)
    stale=[p or '(home)' for p in PAGES if open(os.path.join(tmp,p,'index.html')).read()!=open(os.path.join(ROOT,'site',p,'index.html')).read()]
    check('every page in site/ is built from the current sources', stale==[], stale)
    built={p:open(os.path.join(tmp,p,'index.html')).read() for p in PAGES}
    check('no page names another product', not any('svgator' in h.lower() for h in built.values()))
    # every picture a page shows is in site/img/
    missing=[]
    for p,h in built.items():
        for src in re.findall(r'<img[^>]+src="([^"]+)"',h)+re.findall(r'<(?:video[^>]+poster|source[^>]+src)="([^"]+)"',h):
            if src.startswith('data:'): continue
            f=os.path.normpath(os.path.join(ROOT,'site',p,src))
            # the help clips are the editor's own files (public/, deployed as editor/)
            ed=os.path.join(ROOT,'site','editor')
            if f.startswith(ed+os.sep): f=os.path.join(ROOT,'public',f[len(ed)+1:])
            if not os.path.exists(f): missing.append(f'{p or "(home)"} {src}')
    check('every picture and clip a page shows exists', missing==[], missing)
    hero=open(os.path.join(ROOT,'site/src/hero.svg'),'rb').read()
    kb=f'{len(hero)/1024:.1f} KB'
    # gzipped the way the build measures it (Node's zlib, level 9): other gzip implementations differ by a few bytes
    gz=subprocess.run(['node','-e',"const z=require('zlib'),f=require('fs');process.stdout.write((z.gzipSync(f.readFileSync(process.argv[1]),{level:9}).length/1024).toFixed(1)+' KB')",os.path.join(ROOT,'site/src/hero.svg')],capture_output=True,text=True,check=True).stdout
    base=(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')+'site/'
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(5000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        ev=pg.evaluate
        async def go(path):
            await pg.set_viewport_size({'width':1440,'height':900})
            await pg.goto(base+path+'index.html', wait_until='domcontentloaded'); await pg.wait_for_timeout(900)
        animated="[...document.querySelectorAll('.spec')].filter(s=>!(s.querySelector('animate,animateMotion,animateTransform')||[...s.querySelectorAll('.spec-art *')].some(e=>getComputedStyle(e).animationName!=='none'))).map(s=>s.querySelector('h3').textContent)"

        # ---- every page: navigation, footer, phone width
        for path in PAGES:
            await go(path)
            cur=await ev("[...document.querySelectorAll('.nav a[aria-current=page]')].map(a=>a.textContent)")
            check(f'{path or "home"}: the nav marks the page', cur==([NAV[path]] if NAV[path] else []), cur)
            nav=await ev("[...document.querySelectorAll('.nav a')].map(a=>a.textContent)")
            check(f'{path or "home"}: the nav lists the pages', nav==['Home','Features','Design agent','Import','Export','Downloads','Help'], nav)
            foot=await ev("[...document.querySelectorAll('footer nav h2')].map(h=>h.textContent)")
            check(f'{path or "home"}: the footer columns', foot==['Product','Resources','About'], foot)
            await pg.set_viewport_size({'width':390,'height':844}); await pg.wait_for_timeout(250)
            check(f'{path or "home"}: no sideways scroll on a phone', not await ev("document.documentElement.scrollWidth>innerWidth"))

        # ---- home
        await go('')
        check('home: the hero plays the exported scene', await ev("!!(document.getElementById('hero-svg')||{}).player"))
        rows=await ev("[...document.querySelectorAll('#tlNames .nm')].map(e=>e.textContent)")
        check('home: the hero timeline lists the scene\'s layers, a pinned one included', len(rows)==9 and 'Flag' in rows, rows)
        hs=await ev("[[...document.querySelectorAll('#tlNames > div:not(.tl-head)')].filter(d=>d.offsetParent).map(d=>Math.round(d.getBoundingClientRect().height)),[...document.querySelectorAll('#tlRows > .tl-row')].filter(d=>d.offsetParent).map(d=>Math.round(d.getBoundingClientRect().height))]")
        check('home: the hero timeline\'s names and tracks line up, all one height', hs[0]==hs[1] and len(set(hs[0]))==1, hs)
        check('home: the hero points at the design agent', await ev("!!document.querySelector('.hero-pill[href=\"agent/\"]') && !!document.querySelector('.app-agent')"))
        proof=await ev("document.querySelector('.proof b').textContent")
        check('home: the proof strip quotes the hero file\'s size', proof==kb, (proof,kb))
        steps=await ev("[...document.querySelectorAll('#flow .step h3')].map(h=>h.textContent)")
        check('home: the scroll-driven workflow, in three steps', steps==['Draw or bring in artwork','Animate on the timeline','Export one file'], steps)
        await ev("document.querySelectorAll('#flow .step')[2].scrollIntoView({block:'center',behavior:'instant'})"); await pg.wait_for_timeout(500)
        check('home: scrolling moves the workflow\'s playhead', await ev("document.querySelectorAll('#flow .step')[2].classList.contains('on')"))
        cards=await ev("[...document.querySelectorAll('.spec h3')].map(h=>h.childNodes[0].textContent.trim())")
        check('home: eight feature cards', cards==['Shape morphing','Motion paths','Trim path','Bones and IK','Pins and mesh warp','Filters','Animation presets','Graph editor'], cards)
        check('home: every card animates', await ev(animated)==[])
        kinds=await ev("[...document.querySelectorAll('.kinds h3')].map(h=>h.textContent)")
        check('home: four kinds of export', kinds==['Animated SVG','Video','GIF & Animated WebP','Image'], kinds)
        check('home: the player download link', await ev("!!document.querySelector('.embed-bar a[href=\"downloads/#player\"]')"))
        check('home: thumbnails for Windows and Linux', await ev("document.querySelectorAll('#fits a[href=\"downloads/#thumbs\"]').length")==2)
        check('home: the finale\'s film strips', await ev("document.querySelectorAll('.final .strip').length")==2)
        tcs=await ev("[...document.querySelectorAll('main .tc')].map(e=>e.textContent)")
        check('home: section timecodes run in order', [t for t in tcs if t[0].isdigit()]==['0:03.00','0:06.00','0:09.00','0:12.00'], tcs)
        await pg.screenshot(path=OUT+'site.png', full_page=True)
        await pg.set_viewport_size({'width':390,'height':844}); await pg.wait_for_timeout(300)
        check('home: the hero timeline label fits on a phone', await ev("(()=>{const h=document.querySelector('.tl-head');return h.scrollWidth<=h.clientWidth})()"))

        # ---- features
        await go('features/')
        groups=await ev("[...document.querySelectorAll('.grp .ghead h2')].map(h=>h.textContent)")
        check('features: six groups and Beyond the editor', groups==['Draw','Style','Animate','Timing','SVG interactions','Workflow','Beyond the editor'], groups)
        check('features: the side index links every group', await ev("[...document.querySelectorAll('.idx a:not(.sub)')].slice(0,6).map(a=>a.getAttribute('href'))")==['#draw','#style','#animate','#timing','#interact','#workflow'])
        check('features: every animated tile animates', await ev(animated)==[])
        check('features: the Import tile shows an SVG coming in as layers', await ev("!!document.querySelector('.tile .ta-imp')"))
        n=await ev("document.querySelectorAll('.tile').length")
        check('features: the tiles', n>=27, n)
        txt=await ev("document.querySelector('main').textContent")
        check('features: bones squash and stretch, masks by brightness', 'squash and stretch' in txt and 'opacity or brightness' in txt)
        await ev("document.getElementById('tools').scrollIntoView({block:'center',behavior:'instant'})"); await pg.wait_for_timeout(600)
        got={}
        for k in ['w','e','s','+','=','-','b']:
            await pg.keyboard.press(k); await pg.wait_for_timeout(60)
            got[k]=await ev("document.getElementById('keyOut').textContent.split('.')[0]")
        check('features: tool keys answer, the newer tools too', got=={'w':'Pin','e':'Edit bone','s':'Scale bone','+':'Add node','=':'Add node','-':'Remove node','b':'Bone'}, got)
        await ev("document.getElementById('timing').scrollIntoView({behavior:'instant'})"); await pg.wait_for_timeout(500)
        check('features: the side index follows the page', await ev("(document.querySelector('.idx a.on')||{}).textContent")=='04 Timing')
        still=await ev("[...document.querySelectorAll('.tile')].filter(t=>!t.classList.contains('spec')&&!t.querySelector('video')).map(t=>t.querySelector('h3').textContent)")
        check('features: every tile moves (a demo or a clip of the editor)', still==[], still)
        spots=await ev("[...document.querySelectorAll('.spot')].filter(s=>!s.querySelector('video')).length")
        check('features: every spotlight is a clip of the editor', spots==0, spots)
        await ev("document.getElementById('draw').scrollIntoView({behavior:'instant'})"); await pg.wait_for_timeout(1500)
        t=await ev("(()=>{const v=[...document.querySelectorAll('#draw .spot video')].find(v=>v.offsetParent);return v?v.currentTime:-1})()")
        check('features: a clip plays when it scrolls into view', t>0.2, t)
        await ev("scrollTo(0,document.body.scrollHeight)"); await pg.wait_for_timeout(600)
        check('features: …and pauses out of view', await ev("[...document.querySelectorAll('#draw .spot video')].every(v=>v.paused)"))

        # ---- agent
        await go('agent/')
        tools=await ev("[...document.querySelectorAll('.tchips code')].map(c=>c.textContent)")
        check('agent: the 23 tools', len(tools)==23 and len(set(tools))==23, tools)
        check('agent: the skill and the guide', await ev("!!document.querySelector('a[href=\"../editor/downloads/svgcinema-skill.zip\"]') && !!document.querySelector('a[href=\"../editor/llms.txt\"]')"))
        check('agent: both ways to connect', await ev("document.querySelectorAll('.ways-t tbody tr').length")==6)
        check('agent: its pictures are clips of the panel', await ev("document.querySelectorAll('main video.vid.cap-l').length")==4)

        # ---- import
        await go('import/')
        imp=await ev("[...document.querySelectorAll('#open .fact h3')].map(h=>h.textContent)")
        check('import: a clip of an animated SVG coming in', await ev("document.querySelectorAll('.imp-hero video.vid').length")==2)
        check('import: other tools, animated SVGs, CSS animations, own exports', len(imp)==6 and 'Animated SVGs' in imp and any('CSS' in x for x in imp), imp)

        # ---- export
        await go('export/')
        sizes=await ev("[...document.querySelectorAll('.sizes b')].map(e=>e.textContent)")
        check('export: the quoted sizes are the hero file\'s', sizes[:2]==[kb,gz], (sizes,kb,gz))
        await pg.click('#tab-next')
        check('export: a Next.js embed tab', '"use client"' in await ev("document.getElementById('codeEl').textContent") and 'use client' in await ev("document.getElementById('codeNote').textContent"))
        check('export: the image demo', await ev("!!document.getElementById('xpanel')"))
        await ev("document.getElementById('xpanel').scrollIntoView({behavior:'instant'})")
        await pg.wait_for_function("/KB|MB/.test(document.getElementById('xpOutSize').textContent)", timeout=15000)
        check('export: the image demo encodes', True)
        ids=await ev("['svg','scroll','player','vid','gif','img'].filter(i=>!document.getElementById(i))")
        check('export: a section for every kind, the player and scroll', ids==[], ids)
        check('export: linked to scroll is part of Animated SVG, not a row of its own', await ev("!!document.querySelector('#svg #scroll')") and 'scrolling story' not in (await ev("document.querySelector('.choose').textContent")).lower())
        check('export: one player download', await ev("[...document.querySelectorAll('a[href$=\".js\"]')].map(a=>a.getAttribute('href'))")==['../editor/downloads/cin-player.min.js'])

        # ---- downloads
        await go('downloads/')
        dl=await ev("[...document.querySelectorAll('main a[download]')].map(a=>a.getAttribute('href'))")
        rel='../editor/downloads/'
        check('downloads: thumbnails, the player and the skill, from the editor\'s downloads folder', dl==[rel+'SVGcinema-Thumbnails-Setup.zip',rel+'svgcinema-thumbnails.deb',rel+'svgcinema-thumbnails-linux.tar.gz',rel+'cin-player.min.js',rel+'svgcinema-skill.zip'], dl)
        check('downloads: six projects in the folder, and the Windows warning', await ev("document.querySelectorAll('.th-file').length")==6 and await ev("!!document.querySelector('.th-warn')"))
        check('downloads: the guide for AI assistants', await ev("!!document.querySelector('a[href=\"../editor/llms.txt\"]')"))

        # ---- help: the hub, a topic page, the lightbox
        await go('help/')
        rows=await ev("[...document.querySelectorAll('.hrow span:first-child')].map(e=>e.textContent)")
        check('help: the hub lists every topic that has a page', rows==[t['title'] for g in HELP['groups'] for t in READY if t['group']==g['id']], rows)
        gs=await ev("[...document.querySelectorAll('.hgroup h3')].map(e=>e.textContent)")
        check('help: only groups with a topic show', gs==[g['title'] for g in HELP['groups'] if any(t['group']==g['id'] for t in READY)], gs)
        check('help: a Start here card per guided tour, each moving', await ev("[...document.querySelectorAll('.hcard')].every(c=>c.querySelector('video.vid'))") and await ev("document.querySelectorAll('.hcard').length")==len([t for t in READY if t.get('tour')]))
        await pg.fill('#helpQ','bounce'); await pg.wait_for_timeout(150)
        vis=await ev("[...document.querySelectorAll('.hrow')].filter(r=>!r.hidden).map(r=>r.querySelector('span').textContent)")
        check('help: search finds a topic by its steps', vis==['Easing'], vis)
        await pg.fill('#helpQ','zzzz'); await pg.wait_for_timeout(150)
        check('help: …and says when nothing matches', await ev("!document.getElementById('helpNone').hidden"))
        await pg.fill('#helpQ','')
        t0=READY[1] if len(READY)>1 else READY[0]
        await go(f"help/{t0['id']}/")
        steps=await ev("[...document.querySelectorAll('.hsteps h3')].map(e=>e.textContent)")
        check('help: a topic page has its steps', steps==[s['title'] for s in t0['steps']], steps)
        check('help: …each with a clip in both themes', await ev("[...document.querySelectorAll('.hsteps li')].every(l=>l.querySelectorAll('video.vid').length==2)"))
        side=await ev("[...document.querySelectorAll('.hs-g summary')].map(e=>e.childNodes[0].textContent)")
        check('help: the sidebar follows the hub\'s groups, the topic\'s group open', side==gs and await ev("document.querySelector('.hs-g[open] a[aria-current=page]').textContent")==t0['title'], side)
        check('help: what you\'ll make is the exported SVG', await ev(f"!!document.querySelector('.hgoal img[src$=\"help/{t0['id']}.svg\"]')"))
        href=await ev("document.querySelector('a[data-tour]').getAttribute('href')")
        check('help: the tour opens a practice editor', href.endswith(f"editor/?tour={t0['id']}"), href)
        await pg.click('.htour a[data-tour]'); await pg.wait_for_timeout(300)
        check('help: …in a lightbox over the page', await ev(f"!!document.querySelector('.lb iframe[src$=\"?tour={t0['id']}\"]')"))
        await pg.click('.lb-x'); await pg.wait_for_timeout(200)
        check('help: …that closes', await ev("!document.querySelector('.lb')"))

        # ---- licence
        await go('licence/')
        check('licence: the terms', 'All rights reserved' in await ev("document.querySelector('.licence').textContent"))
        await b.close()
    R['errors']=errs; print(json.dumps(R,indent=1,ensure_ascii=False)); print('FAILS',F+(['errors'] if errs else []))
asyncio.run(main())
