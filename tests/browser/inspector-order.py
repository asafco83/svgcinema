import asyncio, sys, json
from playwright.async_api import async_playwright
import os
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The Inspector's section order and the changes that came with it (the "Properties panel" boards on the
# Keyline UI refresh canvas): the layer's own section right after Keyframe, Size inside each shape's own
# section, Morph (renamed from "Path & morph") on rectangles and ellipses too, Convert to path on stars,
# Size on imported elements, and the selection box for several layers.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(device_scale_factor=1)
        await pg.set_viewport_size({'width':1440,'height':1000}); pg.set_default_timeout(6000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.K=await import('/src/core/constants.ts'); window.IN=await import('/src/ui/inspector.ts')}")
        ev=lambda js: pg.evaluate(js); R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        async def pick(name):
            await ev(f"(()=>{{const l=st.doc.layers.find(x=>x.name==={json.dumps(name)});hi.select(l.id);IN.renderInspector()}})()")
            await pg.wait_for_timeout(80)
        titles=lambda: ev("[...document.querySelectorAll('#insp .sec > h3')].map(h=>(h.childNodes[0].textContent||'').trim())")
        inSec=lambda title, sel: ev(f"(()=>{{const h=[...document.querySelectorAll('#insp .sec > h3')].find(h=>h.childNodes[0].textContent.trim()==={json.dumps(title)});return !!(h&&h.parentElement.querySelector({json.dumps(sel)}))}})()")
        def order_ok(t, first, tail):
            # the layer's own section first, then the shared ones, Morph / Rig last (those present)
            if not t or t[0]!=first: return False
            idx=[t.index(x) for x in tail if x in t]
            return idx==sorted(idx)
        SHARED=['Transforms','Pins','Motion path','Text appearance','Fill & stroke','Appearance','Filters','Morph','Rig']

        await pick('Sky'); t=await titles()
        check('rectangle: Rectangle first, Morph after Filters, Rig last', order_ok(t,'Rectangle',SHARED) and 'Morph' in t and t[-1]=='Rig', t)
        check('rectangle: Size in its own section, not in Morph', await inSec('Rectangle','[data-f="sz:0"]') and not await inSec('Morph','[data-f^="sz"]'))
        check('rectangle: Morph says it becomes a path', await ev("[...document.querySelectorAll('#insp .sec p')].some(p=>p.textContent.includes('turns this rectangle into a plain path'))"))
        check('no "Path & morph" title any more', 'Path & morph' not in t)

        await pick('Sun'); t=await titles()
        check('ellipse: Ellipse first, then Transforms; Morph present', order_ok(t,'Ellipse',SHARED) and t[1]=='Transforms' and 'Morph' in t, t)

        await pick('Blob'); t=await titles()
        check('path: a Path section with its Size first', t[0]=='Path' and await inSec('Path','[data-f="sz:0"]') and not await inSec('Morph','[data-f^="sz"]'), t)
        check('path: Morph near the end', order_ok(t,'Path',SHARED) and 'Morph' in t, t)

        await pick('Star'); t=await titles()
        check('star: Star section first with Size and Convert to path', t[0]=='Star' and await inSec('Star','[data-f="sz:0"]') and await inSec('Star','[data-act="topath"]'), t)
        await pg.click('#insp [data-act="topath"]'); await pg.wait_for_timeout(120)
        check('star: Convert to path makes a plain path', await ev("!st.selLayer().shape") and (await titles())[0]=='Path', await titles())
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(120)

        await pick('Pole'); t=await titles()
        check('line: Line section first, with Size above From / To', t[0]=='Line' and await inSec('Line','[data-f="sz:0"]') and await inSec('Line','#ln-0-0'), t)

        await pick('Title'); t=await titles()
        check('text: Text first, Text appearance before Fill & stroke', order_ok(t,'Text',SHARED) and t.index('Text appearance')<t.index('Fill & stroke'), t)
        check('text: no Morph', 'Morph' not in t)

        await pick('Sunrise'); t=await titles()
        check('group: Group first', order_ok(t,'Group',SHARED), t)

        await pick('Stem'); t=await titles()
        check('bone: Bone first, then Transforms', t[:2]==['Bone','Transforms'], t)

        # an image (its file missing is fine for the layout)
        await ev("(()=>{const l=st.mkLayer('image','Pic',{x:0,y:0,w:40,h:40,asset:'none'},K.NOFILL);st.doc.layers.push(l);hi.commit({insp:true})})()")
        await pick('Pic'); t=await titles()
        check('image: Image first', order_ok(t,'Image',SHARED), t)

        # an imported element: Size stretches it from its own box
        await ev("(()=>{const l=st.mkLayer('raw','Badge',{markup:'<rect x=\"300\" y=\"100\" width=\"100\" height=\"50\" fill=\"#f80\"/>'},K.NOFILL);st.doc.layers.push(l);hi.commit({insp:true})})()")
        await pick('Badge'); await pg.wait_for_timeout(150); await pick('Badge'); t=await titles()
        check('imported element: its section first, with a Size row', order_ok(t,'Imported element',SHARED) and await inSec('Imported element','[data-f="sz:0"]'), t)
        w0=await ev("document.getElementById('e-'+st.selLayer().id).getBoundingClientRect().width")
        check('imported element: Size shows its own box', await ev("+document.querySelector('#insp [data-f=\"sz:0\"]').value")==100, await ev("document.querySelector('#insp [data-f=\"sz:0\"]').value"))
        await pg.fill('#insp [data-f="sz:0"]','200'); await pg.press('#insp [data-f="sz:0"]','Tab'); await pg.wait_for_timeout(120)
        w1=await ev("document.getElementById('e-'+st.selLayer().id).getBoundingClientRect().width")
        check('imported element: W 200 stretches it twice as wide', abs(w1-2*w0)<1.5, (w0,w1))
        await ev("hi.setTime(0)"); await pg.click('#insp [data-kb="sz"]'); await ev("hi.setTime(1)"); await pg.wait_for_timeout(60)
        await pg.fill('#insp [data-f="sz:0"]','100'); await pg.press('#insp [data-f="sz:0"]','Tab'); await pg.wait_for_timeout(60)
        sx=await ev("[0,0.5,1].map(t=>K.H.comp(st.selLayer(),t).sx)")
        check('imported element: Size animates (W 200 at 0s, 100 at 1s)', abs(sx[0]-2)<0.01 and abs(sx[2]-1)<0.01 and 1<sx[1]<2, sx)
        css=await ev("(async()=>{const m=await import('/src/export/build.ts');const o=st.doc.ex.mode;st.doc.ex.mode='css';const s=m.buildExport(null).code;st.doc.ex.mode=o;return s})()")
        bid=await ev("st.selLayer().id")
        check('imported element: CSS export animates its stretch', isinstance(css,str) and (bid+'-g') in css, len(css) if isinstance(css,str) else css)
        await ev("hi.setTime(0)")

        # a rectangle with an animated radius starts morphing: it becomes a path and keeps the radius as Morph keys
        await ev("(()=>{const l=st.mkLayer('rect','Box',{x:40,y:300,w:120,h:80,rx:0},{fill:'#3b5bfd'});l.t.rad=[[0,0,'ease'],[1,24,'ease']];st.doc.layers.push(l);hi.commit({insp:true})})()")
        await pick('Box'); await ev("hi.setTime(0.5)"); await pg.wait_for_timeout(60)
        await pg.click('#insp [data-kb="d"]'); await pg.wait_for_timeout(120)
        info=await ev("(()=>{const l=st.selLayer();return {type:l.type,rad:!!l.t.rad,d:(l.t.d||[]).map(q=>q[0])}})()")
        check('rectangle: Morph ◆ turns it into a path, radius keys kept as Morph keys plus the new one', info['type']=='path' and not info['rad'] and info['d']==[0,0.5,1], info)
        await ev("hi.setTime(0)"); await pg.click('#insp [data-kb="d"]'); await pg.wait_for_timeout(60)
        check('a baked key at the playhead is not toggled off by the conversion', True)
        await pg.keyboard.press('Control+z'); await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(120)
        check('undo brings the rectangle and its radius keys back', await ev("(()=>{const l=st.doc.layers.find(x=>x.name==='Box');return l.type==='rect'&&l.t.rad.length===2&&!l.t.d})()"))
        await ev("hi.setTime(0)")

        # several layers: Keyframe above, then the selection box
        await ev("(()=>{const a=st.doc.layers.find(x=>x.name==='Sky'),b=st.doc.layers.find(x=>x.name==='Badge');hi.select(a.id);hi.select(b.id,'toggle');IN.renderInspector()})()")
        await pg.wait_for_timeout(80); t=await titles()
        check('several layers: the selection section and its box', t[0]=='2 layers selected' and await ev("!!document.getElementById('sb-x')&&!!document.getElementById('sb-w')"), t)
        x0=await ev("+document.getElementById('sb-x').value")
        bx=await ev("(async()=>{const o=await import('/src/render/overlay.ts');return st.doc.layers.filter(l=>['Sky','Badge'].includes(l.name)).map(l=>o.boxOf(l).x)})()")
        await pg.fill('#sb-x', str(x0+10)); await pg.press('#sb-x','Tab'); await pg.wait_for_timeout(120)
        bx2=await ev("(async()=>{const o=await import('/src/render/overlay.ts');return st.doc.layers.filter(l=>['Sky','Badge'].includes(l.name)).map(l=>o.boxOf(l).x)})()")
        check('several layers: X moves every layer', all(abs(q-p0-10)<0.6 for p0,q in zip(bx,bx2)), (bx,bx2))
        w0=await ev("+document.getElementById('sb-w').value"); h0=await ev("+document.getElementById('sb-h').value")
        await pg.fill('#sb-w', str(round(w0/2,2))); await pg.press('#sb-w','Tab'); await pg.wait_for_timeout(120)
        w1=await ev("+document.getElementById('sb-w').value"); h1=await ev("+document.getElementById('sb-h').value")
        check('several layers: W scales the selection, keeping proportions', abs(w1-w0/2)<1 and abs(h1-h0/2)<1, (w0,h0,w1,h1))
        await ev("(()=>{const l=st.doc.layers.find(x=>x.name==='Sky');const tr=Object.values(l.t).find(t=>t&&t.length);if(tr)st.S.keys.add(tr[0]);IN.renderInspector()})()")
        t=await titles()
        check('several layers: the selection section first (the Keyframe section moved to the Easing panel)', t[0]=='2 layers selected' and 'Keyframe' not in t, t)
        await pg.screenshot(path=OUT+'inspector-order.png')

        check('no page errors', not errs, errs[:3])
        print(json.dumps(R,indent=1)); print('FAILS',F)
        await b.close()
asyncio.run(main())
