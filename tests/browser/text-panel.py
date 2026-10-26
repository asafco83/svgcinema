import asyncio, sys, json
from playwright.async_api import async_playwright
import os
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(device_scale_factor=1)
        await pg.set_viewport_size({'width':1440,'height':1000}); pg.set_default_timeout(5000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        pg.on('console',lambda m: m.type=='error' and errs.append(m.text))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/'), wait_until='domcontentloaded'); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); }")
        ev=lambda js: pg.evaluate(js); R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        tid=await ev("st.doc.layers.find(l=>l.name==='Made with SVGcinema').id"); await ev(f"hi.select('{tid}')")
        L=f"st.layerById('{tid}')"
        heads=await ev("[...document.querySelectorAll('#insp .sec h3')].map(h=>h.childNodes[0].textContent.trim())")
        check('sections', all(x in heads for x in ['Text','Transforms','Text appearance','Fill & stroke','Appearance','Filters']), heads)
        check('align bar', await ev("document.querySelectorAll('.align-bar [data-align]').length")==8)
        check('distribute disabled with one layer', await ev("document.querySelector('[data-align=disth]').disabled"))
        sz=await ev("[document.getElementById('bb-w').value,document.getElementById('bb-h').value]")
        check('size shown', all(float(v)>0 for v in sz), sz)
        # rotate turns+deg
        await pg.fill('#rot-turn','1'); await pg.fill('#rot-deg','30'); await pg.press('#rot-deg','Enter')
        await pg.evaluate("document.activeElement.blur()")
        check('rotate = 390', await ev(f"{L}.b.rot")==390, await ev(f"{L}.b.rot"))
        # skew
        await pg.fill('#i-skw_0','12'); await pg.press('#i-skw_0','Tab')
        tf=await ev(f"document.getElementById('e-{tid}').getAttribute('transform')")
        check('skew applied', 'skewX(12)' in tf, tf)
        # scale lock
        await pg.click('[data-act=scllock]'); await pg.fill('#i-scl_0_100','200'); await pg.press('#i-scl_0_100','Tab')
        check('scale lock keeps ratio', await ev(f"{L}.b.scl")==[2,2], await ev(f"{L}.b.scl"))
        # style toggles
        await pg.click('[data-tx=italic]'); await pg.click('[data-tx=deco][data-v=underline]'); await pg.click('[data-tx=bold]')
        a=await ev(f"(()=>{{const t=document.getElementById('e-{tid}-s');return [t.getAttribute('font-style'),t.getAttribute('text-decoration'),t.getAttribute('font-weight')]}})()")
        check('italic/underline/bold toggles', a[0]=='italic' and a[1]=='underline', a)
        check('style select follows', (await ev("document.getElementById('tx-style').value")).startswith(a[2]), await ev("document.getElementById('tx-style').value"))
        await pg.select_option('#tx-style','300|0')
        check('style select sets weight', await ev(f"[{L}.geo.weight,{L}.geo.italic]")==['300',False])
        # letter spacing
        await pg.fill('#g-ls','3'); await pg.press('#g-ls','Tab')
        check('letter spacing', await ev(f"document.getElementById('e-{tid}-s').getAttribute('letter-spacing')")=='3')
        # align buttons
        await pg.click('[data-tx=anchor][data-v=middle]')
        check('align center', await ev(f"{L}.geo.anchor")=='middle')
        # keep width
        await pg.click('[data-tx=wrap]')
        ww=await ev(f"{L}.geo.ww"); check('keep width on sets W', await ev(f"{L}.geo.wrap") and ww>0, ww)
        await pg.fill('#g-ww','60'); await pg.press('#g-ww','Tab')
        ts=await ev(f"document.querySelectorAll('#e-{tid}-s tspan').length")
        check('narrow width wraps into lines', ts>1, ts)
        check('line height field shown', await ev("!!document.getElementById('g-lh')"))
        # fill opacity / swap
        await pg.fill('#i-fo__100','50'); await pg.press('#i-fo__100','Tab')
        check('fill opacity', await ev(f"document.getElementById('e-{tid}-s').getAttribute('fill-opacity')")=='0.5')
        f0=await ev(f"[{L}.b.fill,{L}.b.stk]"); await pg.click('[data-act=swap]')
        f1=await ev(f"[{L}.b.fill,{L}.b.stk,{L}.b.fo,{L}.b.so,{L}.b.sw]")
        check('swap fill & stroke', f1[0]==f0[1] and f1[1]==f0[0] and f1[3]==0.5, f1)
        await ev("hi.undo ? 0 : 0"); await pg.keyboard.press('Control+z')
        # blending/iso/opacity slider
        await pg.select_option('#ly-blend','multiply'); await pg.check('#ly-iso')
        sty=await ev(f"document.getElementById('e-{tid}-s').getAttribute('style')")
        check('blend + isolate', sty and 'multiply' in sty and 'isolate' in sty, sty)
        await pg.fill('#op-range','40');
        o=await ev(f"[{L}.b.op, JSON.stringify({L}.t.op), document.getElementById('e-{tid}').getAttribute('opacity'), document.querySelector('[data-f=\"op::100\"]').value]")
        check('opacity slider', o[2]=='0.4' and o[3]=='40', o)
        # line style / dashes
        await pg.click('[data-tx="x:stroke-linecap"][data-v=round]')
        await pg.fill('#x-dash','4 2'); await pg.press('#x-dash','Tab')
        at=await ev(f"(()=>{{const t=document.getElementById('e-{tid}-s');return [t.getAttribute('stroke-linecap'),t.getAttribute('stroke-dasharray')]}})()")
        check('line cap + dashes', at==['round','4, 2'] or at==['round','4 2'], at)
        await pg.click('[data-tx="x:stroke-linejoin"][data-v=round]')
        check('miter greyed out for round join', await ev("document.getElementById('x-miter').disabled"))
        # filters
        await pg.click('#fx-add'); await pg.click('#fxMenu [data-fxp=blur]'); await pg.click('#fx-add'); await pg.click('#fxMenu [data-fxp=shadow]')
        fl=await ev(f"document.querySelector('#{ 'e-'+tid } filter') && document.querySelector('#e-{tid} filter').innerHTML")
        check('filters rendered', fl and 'feGaussianBlur' in fl and 'feDropShadow' in fl, fl)
        await pg.fill('#i-fx_f1_sd','9'); await pg.press('#i-fx_f1_sd','Tab')
        check('blur amount', 'stdDeviation="9"' in await ev(f"document.querySelector('#e-{tid} filter').innerHTML"))
        await pg.click('[data-act=fxmove][data-fx=f2][data-d="-1"]')
        check('filter reorder', await ev(f"{L}.fx.map(f=>f.id).join()")=='f2,f1')
        await pg.click('[data-kb="fx.f1.sd"]')
        check('filter param keyframe', await ev(f"({L}.t['fx.f1.sd']||[]).length")==1)
        await pg.screenshot(path=OUT+'txt-insp.png', clip={'x':1440-330,'y':0,'width':330,'height':1000})
        await pg.evaluate("document.getElementById('insp').scrollTop=2000"); await pg.wait_for_timeout(200)
        await pg.screenshot(path=OUT+'txt-insp2.png', clip={'x':1440-330,'y':0,'width':330,'height':1000})
        await pg.click('[data-act=fxdel][data-fx=f1]')
        check('filter remove cleans tracks', await ev(f"!{L}.t['fx.f1.sd'] && !('fx.f1.sd' in {L}.b)"))
        # timeline label
        # motion path on a non-text layer
        pid=await ev("(st.doc.layers.find(l=>l.type==='path')||{}).id")
        other=await ev("st.doc.layers.find(l=>l.type==='ellipse'||l.type==='rect').id")
        await ev(f"hi.select('{other}')")
        if pid:
            await pg.select_option('#motionPath', pid)
            n=await ev(f"st.layerById('{other}').t.pos.length")
            check('set motion path creates keys', n>=9, n)
        # align to canvas
        await pg.click('[data-align=left]')
        bx=await ev(f"(()=>{{const r=document.getElementById('e-{other}-s').getBoundingClientRect(), c=document.querySelector('#art svg, #stage svg')||null; return r.left}})()")
        R['bx']=bx
        # multi-select align
        await ev(f"(()=>{{st.S.selSet.add('{tid}'); hi.commit({{insp:true}})}})()")
        await pg.click('[data-align=top]')
        tops=await ev(f"[document.getElementById('e-{other}-s').getBoundingClientRect().top,document.getElementById('e-{tid}-s').getBoundingClientRect().top]")
        check('align top to selection', abs(tops[0]-tops[1])<1, tops)
        R['errors']=errs; print(json.dumps(R,indent=1)); print('FAILS',F)
        await b.close()
asyncio.run(main())
