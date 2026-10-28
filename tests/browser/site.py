import asyncio, sys, json, os, subprocess, tempfile, gzip
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The landing page (site/): the built page is current, it runs without errors, the feature cards and
# sections cover the editor's core features (pins, size, dashes, triggers, import of animated SVGs, the
# newer tools), the quoted file sizes match the hero file, the footer carries no links, and the tool keys
# answer real key presses.
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
async def main():
    R={}; F=[]
    def check(n,c,i=None):
        R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
        if not c: F.append(n)
    # the committed page is what the sources build to
    tmp=os.path.join(tempfile.mkdtemp(),'index.html')
    subprocess.run(['node',os.path.join(ROOT,'site/build.mjs'),'--out='+tmp],check=True,capture_output=True)
    built=open(tmp).read()
    check('site/index.html is built from the current sources', built==open(os.path.join(ROOT,'site/index.html')).read())
    check('the page names no other product', 'svgator' not in built.lower())
    hero=open(os.path.join(ROOT,'site/src/hero.svg'),'rb').read()
    kb=f'{len(hero)/1024:.1f} KB'
    # gzipped the way the build measures it (Node's zlib, level 9): other gzip implementations differ by a few bytes
    gz=subprocess.run(['node','-e',"const z=require('zlib'),f=require('fs');process.stdout.write((z.gzipSync(f.readFileSync(process.argv[1]),{level:9}).length/1024).toFixed(1)+' KB')",os.path.join(ROOT,'site/src/hero.svg')],capture_output=True,text=True,check=True).stdout
    base=(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(5000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(base+'site/index.html', wait_until='domcontentloaded'); await pg.wait_for_timeout(1500)
        ev=pg.evaluate
        check('the hero plays the exported scene', await ev("!!(document.getElementById('hero-svg')||{}).player"))
        rows=await ev("[...document.querySelectorAll('#tlNames .nm')].map(e=>e.textContent)")
        check('the hero timeline lists the scene\'s layers, a pinned one included', len(rows)==9 and 'Flag' in rows, rows)
        cards=await ev("[...document.querySelectorAll('.spec h3')].map(h=>h.childNodes[0].textContent.trim())")
        want=['Pins and mesh warp','Size and corners','Dash patterns','Triggers and links','Bones and IK','Shape morphing','Animation presets','Graph editor','Onion skin','Symbols']
        check('sixteen feature cards, the newer features among them', len(cards)==16 and all(w in cards for w in want), cards)
        anim=await ev("[...document.querySelectorAll('.spec')].filter(s=>!(s.querySelector('animate,animateMotion,animateTransform')||[...s.querySelectorAll('.spec-art *')].some(e=>getComputedStyle(e).animationName!=='none'))).map(s=>s.querySelector('h3').textContent)")
        check('every card animates (SMIL or CSS)', anim==[], anim)
        th=await ev("""(()=>{const s=document.getElementById('thumbnails');if(!s)return null;return {h:s.querySelector('h2').textContent, links:[...s.querySelectorAll('a')].map(a=>a.getAttribute('href')), files:s.querySelectorAll('.th-file').length, warn:!!s.querySelector('.th-warn')}})()""")
        rel='editor/downloads/'
        check('project thumbnails section: Windows and Linux downloads from the site’s downloads folder, with the warning', bool(th) and th['links']==[rel+'SVGcinema-Thumbnails-Setup.zip', rel+'svgcinema-thumbnails.deb', rel+'svgcinema-thumbnails-linux.tar.gz'] and th['files']==6 and th['warn'], th)
        check('bones mention squash and stretch; masks mention brightness', await ev("document.getElementById('animate').textContent.includes('squash and stretch') && document.getElementById('animate').textContent.includes('opacity or brightness')"))
        imp=await ev("[...document.querySelectorAll('#import .fact h3')].map(h=>h.textContent)")
        check('an Import section: other tools, animated SVGs, CSS animations, own exports', len(imp)==6 and 'Animated SVGs' in imp and any('CSS' in x for x in imp), imp)
        check('the nav links to it', await ev("!!document.querySelector('.nav a[href=\"#import\"]')"))
        tcs=await ev("[...document.querySelectorAll('.sec .tc, .flow .tc')].map(e=>e.textContent)")
        check('section timecodes run in order', tcs==['0:03.00','0:06.00','0:09.00','0:12.00','0:15.00','0:18.00','0:21.00','0:24.00'], tcs)
        sizes=await ev("[...document.querySelectorAll('.sizes b')].map(e=>e.textContent)")
        check('the quoted sizes are the hero file\'s', sizes[:2]==[kb,gz], (sizes,kb,gz))
        foot=await ev("[...document.querySelectorAll('footer a')].map(a=>a.getAttribute('href')+':'+a.textContent.trim())")
        check('the footer has no Editor or Export links', foot==['#top:'] and not await ev("!!document.querySelector('footer nav')"), foot)
        await pg.click('#tab-next')
        check('a Next.js embed tab', '"use client"' in await ev("document.getElementById('codeEl').textContent") and 'use client' in await ev("document.getElementById('codeNote').textContent"))
        # keys
        await pg.evaluate("document.getElementById('tools').scrollIntoView({behavior:'instant'})"); await pg.wait_for_timeout(600)
        got={}
        for k in ['w','e','s','+','=','-','b']:
            await pg.keyboard.press(k); await pg.wait_for_timeout(60)
            got[k]=await ev("document.getElementById('keyOut').textContent.split('.')[0]")
        check('tool keys answer, the newer tools too', got=={'w':'Pin','e':'Edit bone','s':'Scale bone','+':'Add node','=':'Add node','-':'Remove node','b':'Bone'}, got)
        check('snapping, align and number-drag facts under the keys', len(await ev("[...document.querySelectorAll('#tools .fact')]"))==3)
        await pg.screenshot(path=OUT+'site.png', full_page=True)
        # phone
        await pg.set_viewport_size({'width':390,'height':844}); await pg.wait_for_timeout(300)
        check('no sideways scroll on a phone', not await ev("document.documentElement.scrollWidth>innerWidth"))
        check('the hero timeline label fits on a phone', await ev("(()=>{const h=document.querySelector('.tl-head');return h.scrollWidth<=h.clientWidth})()"))
        await b.close()
    R['errors']=errs; print(json.dumps(R,indent=1,ensure_ascii=False)); print('FAILS',F+(['errors'] if errs else []))
asyncio.run(main())
