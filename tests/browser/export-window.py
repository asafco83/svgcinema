import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The Export window: option sections that collapse like the inspector's (Advanced starts closed and
# shows a summary), a header and footer that stay on screen while only the options scroll, labels and
# buttons on one line, and the file size beside the Download button.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page()
        await pg.set_viewport_size({'width':1440,'height':900}); pg.set_default_timeout(8000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        base=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/'
        await pg.goto(base, wait_until='domcontentloaded'); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); }")
        ev=lambda js, a=None: pg.evaluate(js, a); R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        await ev("localStorage.removeItem('svgcinema:exportClosed'); st.doc.ex.mode='js'; st.doc.ex.player='embed'; st.doc.ex.size='resp'")
        await pg.click('#bExport'); await pg.wait_for_timeout(1500)
        secs=lambda: ev("[...document.querySelectorAll('#mExport .xopts .sec')].filter(s=>!s.hidden).map(s=>[s.querySelector('h3').childNodes[0].textContent.trim(), s.classList.contains('closed')])")
        s0=await secs()
        check('sections in order, Advanced closed by default', s0==[['Format',False],['Playback',False],['Size',False],['Advanced',True]], s0)
        check('every section heading has a collapse toggle', await ev("[...document.querySelectorAll('#mExport .sec > h3')].every(h=>h.querySelector('.sec-tg'))"))
        sm=await ev("(()=>{const e=document.getElementById('xSumAdv');return [e.checkVisibility(), e.textContent]})()")
        check('a closed section shows its summary', sm[0] and sm[1].startswith('Generated IDs · '), sm)
        check('an open section hides its summary', not await ev("document.getElementById('xSumFmt').checkVisibility()"))
        geo=await ev("""(()=>{const d=document.querySelector('#mExport .dlg').getBoundingClientRect(),f=document.querySelector('#mExport footer').getBoundingClientRect(),
            h=document.querySelector('#mExport header').getBoundingClientRect(),o=document.querySelector('#mExport .xopts');
            return {dlg:[d.width,d.height], foot:[f.top,f.bottom,f.height], head:h.height, vh:innerHeight, scrolls:getComputedStyle(o).overflowY}})()""")
        check('960 × 760 window, footer on screen at 1440 × 900', geo['dlg']==[960,760] and geo['foot'][1]<=geo['vh'] and geo['foot'][2]==56 and geo['head']==56, geo)
        check('only the options column scrolls', geo['scrolls']=='auto', geo['scrolls'])
        wrap=await ev("""[...document.querySelectorAll('#mExport .segc button, #mExport .rl, #mExport footer .btn, #mExport h3')].filter(e=>e.checkVisibility()).filter(e=>{
            return e.getClientRects().length>1 || (e.matches('.rl,.segc button') && e.scrollWidth>e.clientWidth+1)}).map(e=>e.textContent.trim())""")
        check('labels and buttons stay on one line', not wrap, wrap)
        ph=await ev("[...document.querySelectorAll('#xPlayer button')].map(b=>b.getBoundingClientRect().height)")
        check('Player buttons are one line high', all(h==26 for h in ph), ph)
        foot=await ev("[document.getElementById('xFileSize').textContent, document.getElementById('xFileSub').textContent]")
        check('footer: file size and what it is', foot[0].endswith('KB') and foot[1]=='JavaScript · player inside', foot)
        st=await ev("document.getElementById('xStats').textContent")
        check('stats chips no longer repeat size and player', 'Size' not in st and 'Player' not in st and 'Layers' in st, st)
        check('Starts / Repeat… stay in Playback', await ev("['xTrig','xIt','xDir','xFill','xSpeed','xFps','xRm'].every(i=>document.getElementById(i).closest('.sec').id==='xSecPlay')"))
        # the about line
        about=await ev("[document.getElementById('xAboutT').textContent, document.getElementById('xAbout').open]")
        check('the JavaScript notes are folded away', about==['What the JavaScript export supports', False], about)
        await pg.click('#xAbout summary')
        check('…and open on click', await ev("document.getElementById('xNote').checkVisibility()") and 'morph' in await ev("document.getElementById('xNote').textContent"))
        # collapse, summary, persistence
        await pg.click('#xSecPlay > h3'); await pg.wait_for_timeout(100)
        check('clicking a heading collapses it', ['Playback',True] in await secs() and not await ev("document.getElementById('xTrig').checkVisibility()"))
        sp=await ev("document.getElementById('xSumPlay').textContent")
        check('Playback summary', sp=='On load · loops forever', sp)
        await pg.click('#xSecAdv > h3'); await pg.wait_for_timeout(100)
        ih=await ev("[...document.querySelectorAll('#xIds button')].map(b=>b.getBoundingClientRect().height)")
        check('Element IDs buttons are one line high', all(h==26 for h in ih), ih)
        check('opening Advanced shows its rows', await ev("document.getElementById('xPre').checkVisibility() && document.getElementById('xProj').checkVisibility()"))
        stored=await ev("JSON.parse(localStorage.getItem('svgcinema:exportClosed'))")
        check('closed sections are remembered', stored==['Playback'], stored)
        await pg.focus('#xSecPlay .sec-tg'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(100)
        check('the toggle opens it from the keyboard', await ev("!document.getElementById('xSecPlay').classList.contains('closed') && document.querySelector('#xSecPlay .sec-tg').getAttribute('aria-expanded')==='true'"))
        await pg.click('#xSecPlay > h3')
        # the summary follows changes
        await ev("(()=>{const e=document.getElementById('xIt');e.value='1';e.dispatchEvent(new Event('change',{bubbles:true}))})()"); await pg.wait_for_timeout(150)
        check('summary follows a change', await ev("document.getElementById('xSumPlay').textContent")=='On load · plays once')
        await pg.click('#xSecPlay > h3'); await pg.select_option('#xIt','0'); await pg.wait_for_timeout(100)
        # triggers: the out row and its short label
        await pg.select_option('#xTrig','scroll'); await pg.wait_for_timeout(300)
        check('scroll trigger: "Scrolled away" row', await ev("document.getElementById('xOutLbl').textContent")=='Scrolled away' and await pg.is_visible('#xOut'))
        await pg.select_option('#xTrig','load'); await pg.wait_for_timeout(300)
        check('on load: no out row', await pg.is_hidden('#xOutRow'))
        # size
        await pg.click('#xSize [data-v=fixed]'); await pg.wait_for_timeout(500)
        g=await ev("""(()=>{const r=e=>document.getElementById(e).getBoundingClientRect(), o=document.querySelector('#mExport .xopts').getBoundingClientRect();
           return {dims:!document.getElementById('xDimRow').hidden && !document.getElementById('xPctRow').hidden, presetR:r('xPreset').right, linkR:r('xLink').right, optsR:o.right}})()""")
        check('Fixed: Dimensions and Scale, Presets stays inside the column', g['dims'] and abs(g['presetR']-g['linkR'])<1 and g['presetR']<=g['optsR']-14, g)
        await pg.click('#xSecSize > h3'); await pg.wait_for_timeout(100)
        ss=await ev("document.getElementById('xSumSize').textContent")
        check('Size summary shows the output size', ss.endswith('px') and '×' in ss, ss)
        await pg.click('#xSecSize > h3'); await pg.click('#xSize [data-v=resp]'); await pg.wait_for_timeout(400)
        # CSS only hides what does not apply
        await pg.click('#xMode [data-v=css]'); await pg.wait_for_timeout(1500)
        check('CSS only: no Player, no Frame rate', await pg.is_hidden('#xPlayerRow') and await pg.is_hidden('#xFpsRow') and await pg.is_hidden('#xImgWarn'))
        check('CSS only: the about line changes', await ev("document.getElementById('xAboutT').textContent")=='What CSS can and can’t do')
        check('footer: CSS only', (await ev("document.getElementById('xFileSub').textContent")).startswith('CSS only'))
        await pg.click('#xMode [data-v=js]'); await pg.wait_for_timeout(1200)
        # the Embed tab hides the zoom buttons
        await pg.click('#xTab [data-v=embed]'); await pg.wait_for_timeout(200)
        check('Embed tab: no Fit / Actual size', await pg.is_hidden('#xPrevZoom') and await pg.is_visible('#xSnip'))
        await pg.click('#xTab [data-v=preview]'); await pg.wait_for_timeout(200)
        check('Preview tab: zoom is back', await pg.is_visible('#xPrevZoom'))
        await pg.screenshot(path=OUT+'export-window.png')
        # after a reload the closed set is kept
        await pg.click('#xSecSize > h3'); await pg.wait_for_timeout(100)
        await pg.reload(wait_until='domcontentloaded'); await pg.wait_for_timeout(2000)
        await pg.click('#bExport'); await pg.wait_for_timeout(1200)
        s1=await secs()
        check('closed sections stay closed after a reload', s1==[['Format',False],['Playback',False],['Size',True],['Advanced',False]], s1)
        await ev("localStorage.removeItem('svgcinema:exportClosed')")
        R['errors']=errs; print(json.dumps(R,indent=1,ensure_ascii=False)); print('FAILS',F+(['errors'] if errs else []))
        await b.close()
asyncio.run(main())
