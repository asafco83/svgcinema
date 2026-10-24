import asyncio, sys, json, os, re
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Batch 1: project names in any language, spell check, letter case, text direction (RTL), Convert to
# shapes, the "Less motion" export option, Edit › Select same, Main menu › Open recent.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(5000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        url=(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')
        await pg.goto(url); await pg.wait_for_timeout(2500)
        await pg.evaluate("""async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts');
          window.te=await import('/src/tools/text-edit.ts'); window.fo=await import('/src/render/fonts.ts');
          window.bu=await import('/src/export/build.ts'); window.rc=await import('/src/io/recent.ts'); window.zp=await import('/src/io/zip.ts');
          window.ss=await import('/src/core/select-same.ts'); }""")
        ev=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        lid=lambda n: ev(f"st.doc.layers.find(l=>l.name==='{n}').id")
        title=await lid('Title')
        stxt=lambda: ev(f"(()=>{{const e=document.getElementById('e-{title}-s');return e?{{t:e.textContent,dir:e.getAttribute('direction'),anchor:e.getAttribute('text-anchor'),tag:e.tagName}}:null}})()")

        # ---- project name in Hebrew: kept as the file name
        await pg.fill('#pname', 'שקיעה בים'); await pg.press('#pname','Enter'); await pg.wait_for_timeout(100)
        await pg.click('#bMenu'); await pg.click('#bSaveAs'); await pg.wait_for_timeout(150)
        check('Save as suggests the project name as typed (Hebrew)', await ev("document.getElementById('sName').value")=='שקיעה בים', await ev("document.getElementById('sName').value"))
        check('the name fields follow the text direction', await ev("document.getElementById('sName').dir")=='auto' and await ev("document.getElementById('pname').dir")=='auto')
        await pg.keyboard.press('Escape'); await ev("document.getElementById('mSave').hidden||document.querySelector('#mSave [data-close]').click()")
        await ev("document.querySelector('#mSave').hidden=true")

        # ---- spell check
        await ev(f"hi.select('{title}')"); await pg.wait_for_timeout(100)
        check('the inspector text box is spell-checked', await ev("document.getElementById('g-text').spellcheck"))
        await ev(f"te.startTextEdit(st.layerById('{title}'))"); await pg.wait_for_timeout(100)
        check('typing on the canvas is spell-checked', await ev("document.querySelector('.cin-tedit').spellcheck"))
        # the underline sits below the baseline: the editor leaves room under the last line so it isn't clipped
        check('the canvas editor leaves room for the spell check underline', await ev("parseFloat(getComputedStyle(document.querySelector('.cin-tedit')).paddingBottom) > 0"))
        check('the spell check underline is styled', await ev("[...document.styleSheets].some(s=>{try{return [...s.cssRules].some(r=>r.selectorText&&r.selectorText.includes('.cin-tedit::spelling-error'))}catch(_){return false}})"))
        await ev("te.endTextEdit()"); await pg.wait_for_timeout(100)

        # ---- letter case
        await pg.click('[data-tx=tcase][data-v=upper]'); await pg.wait_for_timeout(100)
        s=await stxt()
        check('Case › Uppercase shows the text in capitals, the typed text unchanged', s['t']=='GOOD MORNING' and await ev(f"st.layerById('{title}').geo.text")=='Good morning', s)
        check('and its button is on', await ev("document.querySelector('[data-tx=tcase][data-v=upper]').getAttribute('aria-pressed')")=='true')
        await pg.click('[data-tx=tcase][data-v=title]'); await pg.wait_for_timeout(100)
        check('Capitalise each word', (await stxt())['t']=='Good Morning')
        await ev(f"te.startTextEdit(st.layerById('{title}'))"); await pg.wait_for_timeout(100)
        check('the canvas edit box uses the same case', await ev("getComputedStyle(document.querySelector('.cin-tedit')).textTransform")=='capitalize')
        await ev("te.endTextEdit()")
        await pg.click('[data-tx=tcase][data-v=""]'); await pg.wait_for_timeout(100)
        check('As typed', (await stxt())['t']=='Good morning' and await ev(f"st.layerById('{title}').geo.tcase")==None)
        await pg.screenshot(path=OUT+'batch1-text.png', clip={'x':1440-300,'y':0,'width':300,'height':900})

        # ---- direction
        await pg.fill('#g-text', 'בוקר טוב!'); await pg.dispatch_event('#g-text','change'); await pg.wait_for_timeout(150)
        s=await stxt()
        check('Hebrew text reads right to left by itself (direction="rtl")', s['dir']=='rtl', s)
        check('the Right to left button shows it', await ev("document.querySelector('[data-tx=dir][data-v=rtl]').getAttribute('aria-pressed')")=='true')
        await pg.click('[data-tx=anchor][data-v=start]'); await pg.wait_for_timeout(100)
        check('Align left on right-to-left text sets the logical end', await ev(f"st.layerById('{title}').geo.anchor")=='end' and (await stxt())['anchor']=='end')
        check('and Align left stays pressed', await ev("document.querySelector('[data-tx=anchor][data-v=start]').getAttribute('aria-pressed')")=='true')
        await pg.click('[data-tx=dir][data-v=ltr]'); await pg.wait_for_timeout(100)
        s=await stxt()
        check('Left to right: no direction attribute, still aligned left', s['dir'] is None and s['anchor']=='start' and await ev("document.querySelector('[data-tx=anchor][data-v=start]').getAttribute('aria-pressed')")=='true', s)
        await ev("hi.undo()"); await ev("hi.undo()"); await ev("hi.undo()"); await pg.wait_for_timeout(100)
        check('undo goes back to the original text', await ev(f"st.layerById('{title}').geo.text")=='Good morning', await ev(f"st.layerById('{title}').geo.text"))

        # ---- convert to shapes
        await ev(f"hi.select('{title}')"); await pg.wait_for_timeout(100)
        check('a basic font can’t become shapes: no button', await ev("!document.getElementById('txToPath')"))
        await ev(f"(()=>{{const l=st.layerById('{title}');l.geo.family='Heebo';l.geo.weight='400';hi.select(l.id)}})()"); await pg.wait_for_timeout(150)
        check('a Google Font can: Convert to shapes', await ev("!!document.getElementById('txToPath')"))
        # the font comes from the test fixture (no network needed)
        await ev(f"""async()=>{{const m=await import('/@id/opentype.js'); const ot=m.default||m; const buf=await (await fetch('/tests/fixtures/heebo-latin-400-normal.woff')).arrayBuffer();
            fo.facesFor(st.layerById('{title}').geo).forEach(fc=>fo.primeFont(fc.key, ot.parse(buf)));}}""")
        await pg.click('#txToPath'); await pg.wait_for_timeout(400)
        l=await ev(f"(()=>{{const l=st.layerById('{title}');return {{type:l.type,n:(l.b.d||[]).length,op:!!l.t.op,name:l.name}}}})()")
        check('the text becomes a path layer with the letters, keeping its name and animation', l['type']=='path' and l['n']>=8 and l['op'] and l['name']=='Title', l)
        check('drawn as a path on the canvas', await ev(f"document.getElementById('e-{title}-s').tagName")=='path')
        await ev("hi.undo()"); await pg.wait_for_timeout(100)
        check('undo brings the text back', await ev(f"st.layerById('{title}').type")=='text')

        # ---- Less motion (export)
        await ev("hi.select(null)")
        await pg.keyboard.press('Control+e'); await pg.wait_for_timeout(500)
        check('Export has the Less motion option, Play normally by default', await ev("document.getElementById('xRm').value")=='play')
        await pg.select_option('#xRm', 'last'); await pg.wait_for_timeout(300)
        check('choosing Show the last frame is kept', await ev("st.doc.ex.rm")=='last')
        await pg.screenshot(path=OUT+'batch1-export.png')
        await pg.keyboard.press('Escape')
        code=await ev("bu.buildExport(null).code"); dur=await ev("st.doc.dur")
        check('the JS export checks prefers-reduced-motion', 'prefers-reduced-motion: reduce' in code)
        rp=await b.new_page(viewport={'width':640,'height':400}); await rp.emulate_media(reduced_motion='reduce')
        await rp.set_content('<html><body></body></html>')
        await rp.evaluate("c=>{const u=URL.createObjectURL(new Blob([c],{type:'image/svg+xml'}));const o=document.createElement('object');o.type='image/svg+xml';o.data=u;o.id='o';o.style.width='640px';document.body.appendChild(o);}", code)
        await rp.wait_for_timeout(1200)
        st_=await rp.evaluate("(()=>{const d=document.getElementById('o').contentDocument;const s=d&&d.querySelector('svg');const P=s&&s.player;return P?{t:P.currentTime,playing:P.isPlaying}:null})()")
        check('with less motion asked for, the player holds the last frame and doesn’t play', st_ and not st_['playing'] and abs(st_['t']-(dur*1000-1))<2, st_)
        await rp.emulate_media(reduced_motion='no-preference'); await rp.reload(); await rp.set_content('<html><body></body></html>')
        await rp.evaluate("c=>{const u=URL.createObjectURL(new Blob([c],{type:'image/svg+xml'}));const o=document.createElement('object');o.type='image/svg+xml';o.data=u;o.id='o';document.body.appendChild(o);}", code)
        await rp.wait_for_timeout(1200)
        st2=await rp.evaluate("(()=>{const d=document.getElementById('o').contentDocument;const s=d&&d.querySelector('svg');const P=s&&s.player;return P?{t:P.currentTime,playing:P.isPlaying}:null})()")
        check('without it, the animation plays as usual', st2 and (st2['playing'] or st2['t']>0), st2)
        # CSS export: animations held paused
        await ev("st.doc.ex.mode='css'")
        css=await ev("bu.buildExport(null).code")
        await rp.emulate_media(reduced_motion='reduce'); await rp.set_content('<html><body>'+css+'</body></html>'); await rp.wait_for_timeout(300)
        ps=await rp.evaluate("[...document.querySelectorAll('svg *')].filter(e=>getComputedStyle(e).animationName!=='none').map(e=>getComputedStyle(e).animationPlayState)")
        check('the CSS export pauses every animation for less motion', len(ps)>0 and all(x=='paused' for x in ps), (len(ps), set(ps)))
        await rp.close()
        await ev("st.doc.ex.mode='js'; delete st.doc.ex.rm")

        # ---- Select same
        sun=await lid('Sun')
        await ev(f"hi.select('{sun}')"); await pg.wait_for_timeout(100)
        await pg.click('#bMenu'); await pg.hover('#fileMenu [data-sub=edit] > button'); await pg.wait_for_timeout(150)
        await pg.hover('#fileMenu [data-lm="ed:same"]'); await pg.wait_for_timeout(150)
        items=await ev("[...document.querySelectorAll('#fileMenu [data-lm=\"ed:same\"] + .lm-sub button span')].map(s=>s.textContent)")
        check('Edit › Select same lists what applies to the layer', 'Fill' in items and 'Kind of layer' in items and 'Font' not in items, items)
        await pg.click('#fileMenu [data-lm="same:type"]'); await pg.wait_for_timeout(150)
        want=await ev(f"st.doc.layers.filter(l=>l.type===st.layerById('{sun}').type&&!l.hid&&!l.lock).length")
        got=await ev("[...st.S.selSet].map(id=>st.layerById(id).type)")
        check('Select same › Kind of layer picks every visible layer of that kind', len(got)>1 and all(t==got[0] for t in got), (len(got), want))
        check('the clicked layer stays the primary one', await ev("st.S.sel")==sun)

        # ---- Open recent
        await ev("rc.clearRecent()"); await pg.wait_for_timeout(100)
        await pg.click('#bMenu'); await pg.wait_for_timeout(150)
        top=await ev("[...document.querySelectorAll('#fileMenu > .lm-it > button')].map(b=>b.querySelector('span').textContent)")
        check('Open recent sits under Open…', top[:3]==['New project…','Open…','Open recent'], top)
        check('greyed out while the list is empty', await ev("document.querySelector('#fileMenu [data-sub=recent] > button').disabled"))
        await pg.keyboard.press('Escape')
        await ev("""async()=>{ const was=st.doc.name; st.doc.name='Recent test'; const blob=await zp.buildProject(true); st.doc.name=was; await rc.addRecent('Recent test.SVGcinema', null, blob); }""")
        await pg.click('#bMenu'); await pg.wait_for_timeout(200)
        await pg.hover('#fileMenu [data-sub=recent] > button'); await pg.wait_for_timeout(200)
        rl=await ev("[...document.querySelectorAll('#fileMenu [data-sub=recent] .lm-sub button')].map(b=>b.querySelector('span').textContent+'|'+b.querySelector('kbd')?.textContent)")
        check('it lists the project with when it was saved, and Clear the list', rl[:1]==['Recent test|Today'] and rl[-1].startswith('Clear the list'), rl)
        await pg.screenshot(path=OUT+'batch1-recent.png')
        await ev("st.S.dirty=false")
        await pg.click('#fileMenu [data-lm="rc:0"]'); await pg.wait_for_timeout(800)
        check('choosing it opens that project', await ev("st.doc.name")=='Recent test', await ev("st.doc.name"))
        check('the list survives a reload', await ev("rc.recentList().length")==1)
        await pg.reload(); await pg.wait_for_timeout(2500)
        await ev("async()=>{ window.rc=await import('/src/io/recent.ts'); await rc.loadRecent(); }")
        check('(stored in this browser)', await ev("rc.recentList().length")==1 and await ev("rc.recentList()[0].name")=='Recent test.SVGcinema')

        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
