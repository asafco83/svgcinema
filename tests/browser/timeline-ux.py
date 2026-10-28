import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Timeline and selection UX: one transform box around several selected layers (scale and rotate them all),
# Ctrl / Shift selecting layers in the timeline, a track title selecting its keyframes, Linear as the
# default easing, a keyframe added on every selected layer, and the Inspector showing the track's row.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(6000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.K=await import('/src/core/constants.ts')}")
        ev=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        lid=lambda n: ev(f"st.doc.layers.find(l=>l.name==={json.dumps(n)}).id")
        sun=await lid('Sun'); title=await lid('Title'); blob=await lid('Blob')
        vals=lambda k: ev(f"[{json.dumps(sun)},{json.dumps(title)}].map(id=>K.valueAt(st.doc.layers.find(l=>l.id===id),{json.dumps(k)},st.S.time))")
        handles=lambda: ev("Object.fromEntries([...document.querySelectorAll('[data-gx]')].map(e=>{const r=e.getBoundingClientRect();return [e.dataset.gx,[r.x+r.width/2,r.y+r.height/2]]}))")

        # 1. several layers: one box with handles
        await ev(f"(hi.select({json.dumps(sun)}), hi.select({json.dumps(title)},'toggle'))"); await pg.wait_for_timeout(200)
        h=await handles()
        check('several layers: one box with 8 handles and a rotate handle', sorted(h)==sorted(['nw','n','ne','e','se','s','sw','w','rot']), list(h))
        check('…and no single-layer handles', not await ev("!!document.querySelector('#overlay [data-h=\"se\"]')"))
        await pg.screenshot(path=OUT+'timeline-ux-box.png', clip={'x':330,'y':80,'width':800,'height':540})
        s0=await vals('scl'); u0=await ev("st.S.undo.length")
        x,y=h['e']; await pg.mouse.move(x,y); await pg.mouse.down(); await pg.mouse.move(x+80,y,steps=5); await pg.mouse.up()
        s1=await vals('scl')
        check('the side handle scales every layer the same', s1[0][0]>s0[0][0]*1.05 and abs(s1[0][0]-s1[1][0])<1e-6 and s1[0][1]==s0[0][1], (s0,s1))
        check('…as one undo step', await ev("st.S.undo.length")==u0+1)
        await ev("hi.undo()"); await pg.wait_for_timeout(150)
        h=await handles(); x,y=h['rot']; c=h['n']
        await pg.mouse.move(x,y); await pg.mouse.down(); await pg.mouse.move(x+150,y+150,steps=6); await pg.mouse.up()
        r=await vals('rot')
        check('the rotate handle turns them all by the same angle', abs(r[0])>10 and abs(r[0]-r[1])<1e-6, r)
        await ev("hi.undo()")
        # dragging one of the selected layers moves them all (the selection stays)
        await ev(f"(hi.select({json.dumps(sun)}), hi.select({json.dumps(title)},'toggle'))"); await pg.wait_for_timeout(150)
        p0=await vals('pos'); u1=await ev("st.S.undo.length")
        r=await ev(f"(()=>{{const b=document.getElementById('e-'+{json.dumps(sun)}+'-s').getBoundingClientRect();return [b.left+b.width*0.3,b.top+b.height*0.3]}})()")
        await pg.mouse.move(*r); await pg.mouse.down(); await pg.mouse.move(r[0]+60,r[1]+40,steps=6); await pg.mouse.up(); await pg.wait_for_timeout(100)
        p1=await vals('pos')
        d=[(p1[i][0]-p0[i][0],p1[i][1]-p0[i][1]) for i in range(2)]
        check('dragging a selected layer moves every selected layer the same', abs(d[0][0]-d[1][0])<0.6 and abs(d[0][1]-d[1][1])<0.6 and abs(d[0][0])>10, (p0,p1))
        check('…keeps them all selected, as one undo step', await ev("st.S.selSet.size")==2 and await ev("st.S.undo.length")==u1+1)
        await ev("hi.undo()")
        await ev(f"(hi.select({json.dumps(sun)}), hi.select({json.dumps(title)},'toggle'))"); await pg.wait_for_timeout(150)
        hit=await ev(f"(()=>{{const e=document.elementFromPoint({r[0]},{r[1]});const g=e&&e.closest('[id^=e-]');return g?g.id.replace(/^e-|-s$/g,''):''}})()")
        await pg.mouse.click(*r); await pg.wait_for_timeout(150)
        check('a click (no drag) on another layer inside the box picks that layer', hit not in (sun,title) and await ev("st.S.selSet.size")==1 and await ev("st.S.sel")==hit, (hit, await ev("st.S.sel")))

        # 2. Ctrl / Shift in the timeline
        await ev(f"hi.select({json.dumps(sun)})"); await pg.wait_for_timeout(100)
        await pg.locator(f'.tl-layer[data-lid="{blob}"] .tl-lname').click(modifiers=['Control']); await pg.wait_for_timeout(100)
        check('Ctrl-click a layer in the timeline adds it', await ev("st.S.selSet.size")==2 and await ev(f"st.S.selSet.has({json.dumps(sun)})"))
        await pg.locator(f'.tl-layer[data-lid="{blob}"] .tl-lname').click(modifiers=['Control']); await pg.wait_for_timeout(100)
        check('…and again removes it', await ev("st.S.selSet.size")==1)
        await pg.locator(f'.tl-layer[data-lid="{blob}"] .tl-lname').click(modifiers=['Shift']); await pg.wait_for_timeout(100)
        check('Shift-click selects the run of layers up to it', await ev("st.S.selSet.size")>2, await ev("st.S.selSet.size"))

        # 3. a track title selects its keyframes, 6. the Inspector shows its row
        await ev(f"hi.select({json.dumps(blob)})"); await pg.wait_for_timeout(100)
        await pg.locator(f'.tl-prop[data-lid="{blob}"][data-prop="rot"] .tl-pname').click(); await pg.wait_for_timeout(500)
        n=await ev(f"st.doc.layers.find(l=>l.id==={json.dumps(blob)}).t.rot.length")
        check('clicking a track title selects all its keyframes', await ev("st.S.keys.size")==n and n>1, (n, await ev("st.S.keys.size")))
        check('…and the Inspector scrolls to the row and flashes it', await ev("""(()=>{const r=document.querySelector('#insp [data-kb="rot"]').closest('.row'),i=document.getElementById('insp').getBoundingClientRect(),b=r.getBoundingClientRect();return r.classList.contains('flash')&&b.top>=i.top-1&&b.bottom<=i.bottom+1})()"""))

        # 4. Linear by default
        await ev("hi.setTime(0.5)")
        await ev(f"(()=>{{const l=st.doc.layers.find(x=>x.id==={json.dumps(sun)});hi.toggleKey(l,'op');hi.toggleKey(l,'op')}})()")
        await ev("hi.setTime(1.3)"); await ev(f"hi.toggleKey(st.doc.layers.find(x=>x.id==={json.dumps(sun)}),'op')")
        eases=await ev(f"st.doc.layers.find(x=>x.id==={json.dumps(sun)}).t.op.map(q=>q[2])")
        check('new keyframes are Linear', eases and all(e=='linear' for e in eases), eases)

        # 5. a key on every selected layer
        await ev(f"(hi.select({json.dumps(sun)}), hi.select({json.dumps(title)},'toggle'), hi.setTime(2.2))"); await pg.wait_for_timeout(150)
        await pg.locator(f'.tl-prop[data-lid="{sun}"][data-prop="op"] [data-act="key"]').click(); await pg.wait_for_timeout(150)
        at=await ev(f"[{json.dumps(sun)},{json.dumps(title)}].map(id=>(st.doc.layers.find(l=>l.id===id).t.op||[]).some(q=>Math.abs(q[0]-2.2)<0.005))")
        check('the ◆ of a track adds the key on every selected layer', at==[True,True], at)

        # 7–9. the timeline header: length field, Easing panel, Animate; Snap keyframes in the snapping menu
        await ev("(st.S.keys.clear(), hi.select(null))"); await pg.wait_for_timeout(150)
        check('header order: time, length field, Easing, Animate', await ev("[...document.querySelectorAll('.tl-ctrl > *')].map(e=>e.id).filter(Boolean).slice(0,7).join()")=='tStart,tPlay,tLoop,tc,tcTot,tEase,lAnim', await ev("[...document.querySelectorAll('.tl-ctrl > *')].map(e=>e.id).filter(Boolean).join()"))
        check('…no Length box and no Snap button, Animate left the layers panel', not await ev("!!document.getElementById('tSnap') || !!document.querySelector('.lp-foot #lAnim')"))
        check('the length field shows the length as a time', await ev("tDur.value")=='0:03.00', await ev("tDur.value"))
        await pg.fill('#tDur','4'); await pg.press('#tDur','Enter'); await pg.wait_for_timeout(100)
        check('…typing seconds sets it', await ev("st.doc.dur")==4 and await ev("tDur.value")=='0:04.00')
        await pg.fill('#tDur','0:02.50'); await pg.press('#tDur','Tab'); await pg.wait_for_timeout(100)
        check('…and so does a time', await ev("st.doc.dur")==2.5)
        await ev("hi.undo(); hi.undo()")
        check('Easing is greyed out with no keyframe selected', await ev("tEase.disabled"))
        await ev(f"(hi.select({json.dumps(blob)}), st.S.keys.add(st.doc.layers.find(l=>l.id==={json.dumps(blob)}).t.rot[0]), hi.setTime(0))"); await ev("(async()=>{(await import('/src/ui/inspector.ts')).renderInspector()})()"); await pg.wait_for_timeout(200)
        check('…enabled once one is, and the panel stays closed until clicked', not await ev("tEase.disabled") and await ev("ezPop.hidden"))
        check('the Inspector no longer has the Keyframe section', not await ev("!!document.querySelector('#insp #kfsec')"))
        await pg.click('#tEase'); await pg.wait_for_timeout(200)
        g=await ev("(()=>{const p=ezPop.getBoundingClientRect(),t=document.querySelector('.panel.tl').getBoundingClientRect();return {open:!ezPop.hidden,left:p.left,gap:t.top-p.bottom,cols:getComputedStyle(document.querySelector('#ezGrid')).gridTemplateColumns.split(' ').length,tiles:document.querySelectorAll('#ezGrid .ezb').length}})()")
        check('clicking it opens the panel on the left, just above the timeline, presets 3 across', g['open'] and g['left']<=10 and 0<=g['gap']<=10 and g['cols']==3 and g['tiles']>=14, g)
        await pg.click('#ezGrid .ezb[title="Bounce in-out"], #ezGrid .ezb:has(span:text-is("Bounce"))'); await pg.wait_for_timeout(150)
        check('a preset sets the easing of the selected key', 'Bounce' in str(await ev(f"st.doc.layers.find(l=>l.id==={json.dumps(blob)}).t.rot[0][2]")), await ev(f"st.doc.layers.find(l=>l.id==={json.dumps(blob)}).t.rot[0][2]"))
        await pg.screenshot(path=OUT+'timeline-ux-easing.png')
        inside=await ev("""(async()=>{const E=await import('/src/ui/easing.ts');const out={};for(const e of ['outBack','outElastic',[0.3,-0.6,0.6,1.8]]){E.applyEase(e);await new Promise(r=>setTimeout(r,60));
          const sv=document.getElementById('ezEd'),r=sv.getBoundingClientRect(),c=document.getElementById('ezCurve').getBoundingClientRect(),hs=[...sv.querySelectorAll('.hd')].filter(h=>getComputedStyle(h).display!=='none').map(h=>h.getBoundingClientRect());
          out[JSON.stringify(e)]=c.top>=r.top-1&&c.bottom<=r.bottom+1&&hs.every(h=>h.top>=r.top-1&&h.bottom<=r.bottom+1)}return out})()""")
        check('overshooting curves and handles stay inside the curve editor', all(inside.values()), inside)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(100)
        check('Esc closes it', await ev("ezPop.hidden"))
        await pg.click('#vSnap'); await pg.wait_for_timeout(150)
        row=await ev("(()=>{const b=document.querySelector('#viewMenu [data-v=sKeys]');return b&&[b.getAttribute('aria-checked'),b.textContent]})()")
        check('the snapping menu has Snap keyframes, on', bool(row) and row[0]=='true' and 'Snap keyframes' in row[1], row)
        await pg.click('#viewMenu [data-v=sKeys]'); await pg.wait_for_timeout(100)
        check('…which turns keyframe snapping off', await ev("(async()=>{const v=await import('/src/core/view.ts');return v.VIEW.sKeys})()")==False)
        await ev("(async()=>{const v=await import('/src/core/view.ts');v.setView({sKeys:true})})()")
        await pg.keyboard.press('Escape')
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R,indent=1)); print('FAILS',F)
        await b.close()
asyncio.run(main())
