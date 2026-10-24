import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Size shows the scaled size and updates live while scrubbing; Help ▸ Spell check.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(5000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ localStorage.removeItem('svgcinema:spell'); window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); }")
        ev=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        gid=await ev("st.doc.layers.find(l=>l.name==='Ground').id")
        await ev(f"hi.select('{gid}')"); await pg.wait_for_timeout(150)
        w0=await ev("document.getElementById('i-sz_0').value")
        await ev(f"(()=>{{const ed=hi.beginEdit();hi.setProp(st.layerById('{gid}'),'scl',[2,1]);ed.end()}})()"); await pg.wait_for_timeout(150)
        check('scaling updates the Size fields (the size you see)', float(await ev("document.getElementById('i-sz_0').value"))==2*float(w0), (w0, await ev("document.getElementById('i-sz_0').value")))
        await pg.fill('#i-sz_0', str(float(w0))); await pg.press('#i-sz_0','Enter'); await pg.wait_for_timeout(150)
        check('typing a Size divides by the scale (the shape’s own size halves)', abs(await ev(f"(st.layerById('{gid}').b.sz||[0])[0] || document.getElementById('e-{gid}-s').getBBox().width")-float(w0)/2)<0.6, await ev(f"st.layerById('{gid}').b.sz"))
        await ev("hi.undo()"); await ev("hi.undo()"); await pg.wait_for_timeout(150)
        lab=pg.locator('#i-sz_0').locator('xpath=..').locator('span'); bb=await lab.bounding_box()
        g=lambda: ev(f"document.getElementById('e-{gid}-s').getBBox().width")
        a=await g()
        await pg.mouse.move(bb['x']+5,bb['y']+5); await pg.mouse.down(); await pg.mouse.move(bb['x']+45,bb['y']+5,steps=5)
        mid=await g(); await pg.mouse.up()
        check('dragging the Size label resizes the shape live', mid>a+20, (a,mid))
        # spell check in the Help menu
        tid=await ev("st.doc.layers.find(l=>l.name==='Title').id"); await ev(f"hi.select('{tid}')"); await pg.wait_for_timeout(100)
        await pg.click('#bMenu'); await pg.hover('#fileMenu [data-sub=help] > button'); await pg.wait_for_timeout(150)
        check('Help ▸ Spell check, on by default', await ev("document.querySelector('#fileMenu [data-lm=\"hp:spell\"]').getAttribute('aria-checked')")=='true' and await ev("document.getElementById('g-text').spellcheck"))
        await pg.click('#fileMenu [data-lm="hp:spell"]'); await pg.wait_for_timeout(150)
        check('turning it off turns off the text box’s spell check, remembered', not await ev("document.getElementById('g-text').spellcheck") and await ev("localStorage.getItem('svgcinema:spell')")=='0')
        await ev("localStorage.removeItem('svgcinema:spell')")
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
