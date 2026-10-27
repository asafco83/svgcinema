import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# ↑ / ↓ in a number field change its value live (Shift ×10, Alt ×0.1), in the Inspector and elsewhere
# (the document's length steps 0.1 s); holding the key is one undo step; the field keeps the focus.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(5000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); }")
        E=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        await E("hi.select(st.doc.layers.find(l=>l.name==='Title').id)"); await pg.wait_for_timeout(200)
        # Title's position is animated: the field shows (and ↑ / ↓ key) the value at the playhead
        x=lambda: E("parseFloat(document.querySelector('#i-pos_0').value)")
        x0=await x(); u0=await E("st.S.undo.length")
        await pg.focus('#i-pos_0'); await pg.keyboard.press('ArrowUp'); await pg.wait_for_timeout(80)
        check('↑ adds 1, live (a key at the playhead, since it is animated)', abs(await x()-(x0+1))<1e-6 and await E("(()=>{const l=st.doc.layers.find(l=>l.name==='Title'); return l.t.pos.some(k=>k[0]===st.S.time && k[1][0]===%s)})()" % (x0+1)), [x0, await x()])
        check('…the field keeps the focus', await E("document.activeElement && document.activeElement.id")=='i-pos_0')
        await pg.keyboard.press('Shift+ArrowDown'); await pg.wait_for_timeout(80)
        check('Shift+↓ takes 10', abs(await x()-(x0-9))<1e-6, await x())
        await pg.keyboard.press('Alt+ArrowUp'); await pg.wait_for_timeout(80)
        check('Alt+↑ adds 0.1', abs(await x()-(x0-8.9))<1e-6, await x())
        u1=await E("st.S.undo.length")
        check('each press is one undo step', u1==u0+3, [u0,u1])
        # holding: several keydowns, one keyup
        for _ in range(5): await pg.keyboard.down('ArrowUp'); await pg.wait_for_timeout(30)
        await pg.keyboard.up('ArrowUp'); await pg.wait_for_timeout(80)
        check('holding ↑ repeats', abs(await x()-(x0-3.9))<1e-6, await x())
        check('…as one undo step', await E("st.S.undo.length")==u1+1)
        await E("hi.undo()"); await pg.wait_for_timeout(80)
        check('…which Undo takes back at once', abs(await x()-(x0-8.9))<1e-6, await x())
        # a field outside the Inspector's animatable ones: the document length (seconds, 0.1 steps)
        await E("hi.select(null)"); await pg.wait_for_timeout(200)
        d0=await E("st.doc.dur")
        await pg.focus('#d-dur'); await pg.keyboard.press('ArrowUp'); await pg.wait_for_timeout(80)
        check('the document length steps 0.1 s', abs(await E("st.doc.dur")-(d0+0.1))<1e-6, [d0, await E("st.doc.dur")])
        # arrows elsewhere keep their meaning: in a text field nothing changes
        await pg.focus('#agText') if await E("!!document.querySelector('#agText') && !document.querySelector('#agent').hidden") else None
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
