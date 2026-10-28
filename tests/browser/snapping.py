import asyncio, sys, json
from playwright.async_api import async_playwright
import os
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(device_scale_factor=1); await pg.set_viewport_size({'width':1440,'height':1000}); pg.set_default_timeout(5000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ localStorage.removeItem('cin-view'); window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.TR=await import('/src/ui/tools-rail.ts'); window.V=await import('/src/core/view.ts'); window.OVL=await import('/src/render/overlay.ts')}")
        ev=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        async def drag(a,b2,steps=8,up=True):
            await pg.mouse.move(*a); await pg.mouse.down(); await pg.mouse.move(*b2,steps=steps)
            if up: await pg.mouse.up(); await pg.wait_for_timeout(100)
        await ev("hi.setTime(0)")
        # only the shapes drawn here may be snap targets (the sample has points and edges everywhere)
        await ev("(()=>{st.doc.layers.forEach(l=>l.hid=true);hi.select(null);hi.commit({insp:true})})()")
        await ev("TR.pickTool('rect')"); await drag((600,350),(700,450)); a=await ev("st.S.sel")
        await ev("TR.pickTool('rect')"); await drag((800,500),(860,560)); bid=await ev("st.S.sel"); await ev("TR.pickTool('select')")
        boxA=await ev(f"OVL.boxOf(st.layerById('{a}'))"); boxB0=await ev(f"OVL.boxOf(st.layerById('{bid}'))")
        sc=await ev("st.S.scale")
        # drag B so its left edge lands 3 screen px right of A's right edge -> snaps
        dxs=(boxA['x']+boxA['w']-boxB0['x'])*sc+3
        await drag((812,515),(812+dxs,515),up=False)
        lines=await ev("JSON.stringify(st.S.snapLines)")
        await pg.mouse.up(); await pg.wait_for_timeout(100)
        boxB=await ev(f"OVL.boxOf(st.layerById('{bid}'))")
        check('snaps edge to another object', abs(boxB['x']-(boxA['x']+boxA['w']))<0.05, (boxB['x'], boxA['x']+boxA['w']))
        check('magenta snap line while dragging', lines and '"x":[' in lines and lines!='null', lines)
        check('lines cleared after drop', await ev("!st.S.snapLines"))
        # snapping off (Alt+S)
        await pg.keyboard.press('Alt+s')
        check('Alt+S turns snapping off', await ev("V.VIEW.snap")==False)
        bx=await ev(f"OVL.boxOf(st.layerById('{bid}')).x")
        await drag((812+dxs,515),(812+dxs+4,515))
        check('no snapping when off', abs(await ev(f"OVL.boxOf(st.layerById('{bid}')).x")-(bx+4/sc))<0.05)
        await pg.keyboard.press('Alt+s')
        # menus
        await pg.click('#vSnap'); await pg.wait_for_timeout(80)
        items=await ev("[...document.querySelectorAll('#viewMenu button')].map(b=>b.textContent.trim())")
        check('snap menu items', items==['✓Snap to objects','✓Snap to points','✓Snap to guides','Snap to grid','Snap to pixel','✓Enable snappingAlt S','✓Snap keyframesTo the playhead, keys and 0.05 s'], items)
        await pg.click('#viewMenu [data-v=sGrid]'); await pg.click('#viewMenu [data-v=sObjects]'); await pg.click('#viewMenu [data-v=sPoints]')
        await pg.keyboard.press('Escape')
        await drag((615,365),(615+13*sc,365+7*sc))
        bA=await ev(f"OVL.boxOf(st.layerById('{a}'))")
        check('grid snap (10)', abs(bA['x']/10-round(bA['x']/10))<0.01 or abs(bA['y']/10-round(bA['y']/10))<0.01, bA)
        # grid menu: back grid + rulers
        await pg.click('#vGrid'); await pg.click('#viewMenu [data-v=gridBack]'); await pg.click('#viewMenu [data-v=rulers]'); await pg.keyboard.press('Escape')
        check('back grid drawn', await ev("!!document.querySelector('#gridBack rect')"))
        check('rulers shown', await ev("!document.getElementById('rulerX').hidden && !document.getElementById('rulerY').hidden"))
        # drag a guide from the top ruler
        rx=await ev("(()=>{const r=document.getElementById('rulerX').getBoundingClientRect();return [r.x+300,r.y+10]})()")
        await drag(tuple(rx),(rx[0],420))
        gy=await ev("JSON.stringify(st.doc.guides)")
        check('guide from ruler', gy and '"y":[' in gy and await ev("st.doc.guides.y.length")==1, gy)
        check('guide drawn', await ev("document.querySelectorAll('#overlay .ov-guide').length")==1)
        # move the guide
        gpos=await ev("(()=>{const l=document.querySelector('#overlay .ov-guide-hit'), m=l.getScreenCTM(); const y=+l.getAttribute('y1'); return new DOMPoint(0,y).matrixTransform(m).y})()")
        await drag((1000,gpos),(1000,gpos+40))
        y2=await ev("st.doc.guides.y[0]")
        check('drag moves guide', y2 is not None and abs(y2-(round(await ev("st.doc.guides.y[0]"))))<0.01)
        # snap to guide
        await pg.click('#vSnap'); await pg.click('#viewMenu [data-v=sGrid]'); await pg.keyboard.press('Escape')
        await ev("TR.pickTool('rect')")
        gs=await ev("(()=>{const m=document.getElementById('content').getScreenCTM();return new DOMPoint(0,st.doc.guides.y[0]).matrixTransform(m).y})()")
        await drag((500,gs+3),(560,gs+60)); await ev("TR.pickTool('select')")
        top=await ev("st.selLayer().geo.y")
        check('drawing snaps to a guide', abs(top-await ev("st.doc.guides.y[0]"))<0.05, (top, await ev("st.doc.guides.y[0]")))
        # drop guide on ruler deletes it
        gpos=await ev("(()=>{const l=document.querySelector('#overlay .ov-guide-hit'), m=l.getScreenCTM(); return new DOMPoint(0,+l.getAttribute('y1')).matrixTransform(m).y})()")
        rxy=await ev("document.getElementById('rulerX').getBoundingClientRect().y+8")
        await drag((1000,gpos),(1000,rxy))
        check('dropping on the ruler removes it', await ev("st.doc.guides.y.length")==0)
        await pg.keyboard.press('Alt+r')
        check('Alt+R hides rulers', await ev("document.getElementById('rulerX').hidden"))
        await pg.keyboard.press('Alt+r')
        await pg.screenshot(path=OUT+'snapt.png')
        check('prefs remembered', '"rulers":true' in (await ev("localStorage.getItem('cin-view')") or ''))
        R['errors']=errs; print(json.dumps(R,indent=1)); print('FAILS',F); await b.close()
asyncio.run(main())
