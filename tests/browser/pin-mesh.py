import asyncio, sys, json, math
from playwright.async_api import async_playwright
import os
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Step 6: pins on images, text and groups, bent through a triangle mesh: adding pins, the mesh and its
# density, seams, the Edit pins rest view, picking a group, the chip, and both exports.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(); await pg.set_viewport_size({'width':1440,'height':1000})
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.D=await import('/src/core/dom.ts'); window.B=await import('/src/export/build.ts'); window.SG=await import('/src/render/stage.ts'); window.AS=await import('/src/io/assets.ts'); window.K=await import('/src/core/constants.ts')}")
        ev=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        async def drag(a,c,mod=None):
            if mod: await pg.keyboard.down(mod)
            await pg.mouse.move(a[0],a[1]); await pg.mouse.down(); await pg.mouse.move((a[0]+c[0])/2,(a[1]+c[1])/2,steps=3); await pg.mouse.move(c[0],c[1],steps=3); await pg.mouse.up()
            if mod: await pg.keyboard.up(mod)
            await pg.wait_for_timeout(150)
        # the sample's Flag bends with pins; this test pins it itself, so it starts unpinned
        await ev("(()=>{const l=st.doc.layers.find(l=>l.name==='Flag');delete l.pins;delete l.mesh;delete l.t.pin2;SG.renderAll()})()")
        # an opaque image (one colour, so seams would show), placed on the canvas
        iid=await ev("""(()=>{const c=document.createElement('canvas');c.width=240;c.height=120;const x=c.getContext('2d');x.fillStyle='#3b5bfd';x.fillRect(0,0,240,120);
          const a=AS.addAsset({kind:'image',name:'Card',mime:'image/png',data:c.toDataURL('image/png'),w:240,h:120,size:1000});AS.placeAsset(a,{x:320,y:150});SG.renderAll();return st.selLayer().id})()""")
        await pg.wait_for_timeout(300)
        L=f"st.layerById('{iid}')"
        rect=lambda id: ev(f"(()=>{{const r=document.getElementById('e-{id}-s').getBoundingClientRect();return [r.x,r.y,r.width,r.height]}})()")
        bb=await rect(iid)
        await pg.keyboard.press('w'); await pg.wait_for_timeout(120)
        A=[bb[0]+bb[2]*0.12,bb[1]+bb[3]*0.5]; C=[bb[0]+bb[2]*0.88,bb[1]+bb[3]*0.5]
        await pg.mouse.click(*A); await pg.wait_for_timeout(200); await pg.mouse.click(*C); await pg.wait_for_timeout(300)
        n=await ev(f"{L}.pins.length"); tris=await ev(f"({L}.mesh||{{t:[]}}).t.length")
        check('click adds pins to an image', n==2, n)
        check('the image gets a mesh, drawn triangle by triangle', tris>10 and await ev(f"document.querySelectorAll('#e-{iid}-mesh > g').length")==tris, tris)
        check('the content stays in place, hidden', await ev(f"getComputedStyle(document.getElementById('e-{iid}-s')).visibility")=='hidden')
        chip=await ev("document.getElementById('boneChip').textContent")
        check('chip names the mesh', f'image · mesh of {tris} triangles · 2 pins' in chip, chip)
        check('Mesh row in the Pins section', await ev(f"(()=>{{const v=document.getElementById('pinMeshV');return v&&v.textContent}})()")==f'{tris} triangles')
        # ---- bend: drag pin 2 up at 1 s
        await ev("hi.setTime(1)"); await pg.wait_for_timeout(100)
        await drag(C,[C[0],C[1]-70])
        tr=json.loads(await ev(f"JSON.stringify({L}.t.pin2)"))
        check('drag keys the pin', tr and len(tr)==2 and tr[1][1][1]<tr[0][1][1]-30, tr)
        mats=lambda: ev(f"[...document.querySelectorAll('#e-{iid}-mesh > g')].map(g=>g.getAttribute('transform'))")
        m1=await mats()
        check('triangles move with the pins', any(m!='matrix(1,0,0,1,0,0)' for m in m1))
        box=await ev("(()=>{const r=document.getElementById('e-%s-mesh').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()"%iid)
        check('the image bends up', box[1]<bb[1]-25, (bb,box))
        await pg.mouse.move(10,10)
        await pg.screenshot(path=OUT+'pin-mesh-image.png')
        # seams: inside the bent image every pixel keeps the image's colour
        shot=await pg.screenshot(clip={'x':box[0],'y':box[1],'width':box[2],'height':box[3]})
        open(OUT+'pin-mesh-seams.png','wb').write(shot)
        q=await b.new_page(); await q.set_content('<canvas id=c></canvas>')
        import base64
        seam=await q.evaluate("""async(src)=>{const im=new Image();im.src=src;await im.decode();const c=document.getElementById('c');c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);
          const d=x.getImageData(0,0,c.width,c.height).data,W=c.width,H=c.height,blue=(i)=>Math.abs(d[i]-59)<6&&Math.abs(d[i+1]-91)<6&&Math.abs(d[i+2]-253)<6;
          // pixels well inside the image: their 7x7 neighbourhood is mostly the image colour
          let inside=0,bad=0;for(let y=4;y<H-4;y++)for(let x0=4;x0<W-4;x0++){let k=0;for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)if(blue(((y+dy)*W+x0+dx)*4))k++;if(k>=44){inside++;if(!blue((y*W+x0)*4))bad++;}}
          return [inside,bad]}""", 'data:image/png;base64,'+base64.b64encode(shot).decode())
        await q.close()
        check('no seams between triangles', seam[0]>1000 and seam[1]<=seam[0]*0.004, seam)
        # ---- at 0 s and in Edit pins, the image is at rest
        await ev("hi.setTime(0)"); await pg.wait_for_timeout(80)
        check('at 0 s every triangle is at rest', all(m=='matrix(1,0,0,1,0,0)' for m in await mats()))
        await ev("hi.setTime(1)"); await pg.wait_for_timeout(80)
        await pg.click('#tools [data-group="pins"]', button='right'); await pg.wait_for_timeout(150)
        await pg.click('#toolfly [data-tool="pinedit"]'); await pg.wait_for_timeout(150)
        check('Edit pins shows the image at rest', all(m=='matrix(1,0,0,1,0,0)' for m in await mats()))
        await pg.keyboard.press('w'); await pg.wait_for_timeout(120)
        # ---- density: one undo step, and the mesh rebuilds
        await ev("(()=>{const r=document.getElementById('pinMesh');r.value='160';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}))})()"); await pg.wait_for_timeout(200)
        t2=await ev(f"{L}.mesh.t.length")
        check('a denser mesh has more triangles', t2>tris*2 and await ev("document.getElementById('pinMeshV').textContent")==f'{t2} triangles', (tris,t2))
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(200)
        check('one undo restores the density', await ev(f"{L}.mesh.t.length")==tris and await ev(f"document.querySelectorAll('#e-{iid}-mesh > g').length")==tris)
        # ---- exports: JS player and CSS agree (pixels), at 1 s
        async def shotOf(code, mode, t):
            q=await b.new_page(); await q.set_viewport_size({'width':640,'height':400})
            await q.set_content('<!doctype html><html><body style="margin:0;width:640px">'+code+'</body></html>'); await q.wait_for_timeout(400)
            if mode=='js': await q.evaluate(f"document.querySelector('svg').player.pause().seekTo({t*1000})")
            else: await q.evaluate(f"(()=>{{const s=document.querySelector('svg');s.pauseAnimations();s.setCurrentTime({t});document.getAnimations().forEach(a=>{{a.pause();a.currentTime={t*1000}}})}})()")
            await q.wait_for_timeout(150)
            img=await q.screenshot(); await q.close(); return img
        await ev("st.doc.ex.mode='js'; st.doc.ex.trigger='load'; st.doc.ex.size='fixed'"); js=await ev("B.buildExport(null).code")
        P=(await ev("B.buildExport(null).svgId"))[:-3]
        await ev("st.doc.ex.mode='css'"); css=await ev("B.buildExport(null).code"); await ev("st.doc.ex.mode='js'")
        check('JS export carries the mesh', '"mesh":{"v":[' in js)
        check('CSS export moves each triangle with SMIL', f'<animateTransform xlink:href="#{P}{iid}-m0"' in css and f'@keyframes {P}{iid}-m0' not in css)
        ja=await shotOf(js,'js',1); ca=await shotOf(css,'css',1)
        open(OUT+'pin-mesh-js.png','wb').write(ja); open(OUT+'pin-mesh-css.png','wb').write(ca)
        q=await b.new_page(); await q.set_content('<canvas id=a></canvas><canvas id=b></canvas>')
        diff=await q.evaluate(DIFF:="""async([s1,s2])=>{const L=async(s,id)=>{const im=new Image();im.src=s;await im.decode();const c=document.getElementById(id);c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);return x.getImageData(0,0,c.width,c.height).data};
          const a=await L(s1,'a'),b=await L(s2,'b');let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>40)n++;return [n,a.length/4]}""",
          ['data:image/png;base64,'+base64.b64encode(ja).decode(),'data:image/png;base64,'+base64.b64encode(ca).decode()])
        await q.close()
        check('CSS export draws what the JS export draws', diff[0]<diff[1]*0.003, diff)
        # the bent image is in the export where the editor shows it
        async def exportBox(code):
            q=await b.new_page(); await q.set_viewport_size({'width':640,'height':400}); await q.set_content('<body style="margin:0;width:640px">'+code+'</body>'); await q.wait_for_timeout(300)
            await q.evaluate("document.querySelector('svg').player.pause().seekTo(1000)"); await q.wait_for_timeout(80)
            r=await q.evaluate(f"(()=>{{const e=document.getElementById('{P}{iid}-mesh'),M=document.querySelector('svg').getScreenCTM().inverse(),r=e.getBoundingClientRect(),a=new DOMPoint(r.x,r.y).matrixTransform(M),c=new DOMPoint(r.right,r.bottom).matrixTransform(M);return [a.x,a.y,c.x-a.x,c.y-a.y]}})()")
            await q.close(); return r
        jsbox=await exportBox(js)
        edbox=await ev(f"(()=>{{const e=document.getElementById('e-{iid}-mesh'),M=D.CONTENT.getScreenCTM().inverse(),r=e.getBoundingClientRect(),a=new DOMPoint(r.x,r.y).matrixTransform(M),c=new DOMPoint(r.right,r.bottom).matrixTransform(M);return [a.x,a.y,c.x-a.x,c.y-a.y]}})()")
        check('JS export matches the editor', all(abs(x-y)<1 for x,y in zip(jsbox,edbox)), (jsbox,edbox))
        # ---- text
        tid=await ev("(()=>{const l=st.mkLayer('text','Wave',{x:200,y:330,text:'Bend me',size:40,family:'Inter',weight:600,anchor:'start'},{fill:'#ffd24a'});st.doc.layers.push(l);hi.select(l.id);SG.renderAll();return l.id})()")
        await pg.wait_for_timeout(300)
        tb=await rect(tid)
        await pg.mouse.click(tb[0]+tb[2]*0.1,tb[1]+tb[3]*0.5); await pg.wait_for_timeout(200); await pg.mouse.click(tb[0]+tb[2]*0.9,tb[1]+tb[3]*0.5); await pg.wait_for_timeout(300)
        check('text takes pins and a mesh', await ev(f"st.layerById('{tid}').pins.length")==2 and await ev(f"st.layerById('{tid}').mesh.t.length")>4)
        # ---- groups: Ctrl+click pins the layer inside, a click picks the outermost group
        fid=await ev("st.doc.layers.find(l=>l.name==='Flag').id"); pid=await ev("st.doc.layers.find(l=>l.name==='Pole').id")
        await ev(f"hi.select('{tid}')")
        pb=await rect(pid)
        await pg.keyboard.down('Control'); await pg.mouse.click(pb[0]+pb[2]/2,pb[1]+pb[3]*0.5); await pg.keyboard.up('Control'); await pg.wait_for_timeout(300)
        check('Ctrl+click pins the layer inside', await ev(f"(st.layerById('{pid}').pins||[]).length")==1 and not await ev(f"!!st.layerById('{fid}').pins"))
        await ev(f"hi.select('{tid}')")
        await pg.mouse.click(pb[0]+pb[2]/2,pb[1]+pb[3]*0.9); await pg.wait_for_timeout(300)
        check('a click on a group picks the group', await ev(f"(st.layerById('{fid}').pins||[]).length")==1)
        await pg.mouse.click(pb[0]+pb[2]/2,pb[1]+pb[3]*0.1); await pg.wait_for_timeout(300)
        check('the selected group keeps getting the pins', await ev(f"st.layerById('{fid}').pins.length")==2 and await ev(f"st.layerById('{fid}').mesh.t.length")>4)
        # the group's own animation (the pennant waves) plays inside its bent mesh, in both exports
        await ev("hi.setTime(2.1)"); await pg.wait_for_timeout(100)
        top=await ev(f"(()=>{{const e=document.querySelector('[data-pin=\"2\"]').getBoundingClientRect();return [e.x+e.width/2,e.y+e.height/2]}})()")
        await drag(top,[top[0]+28,top[1]+6])
        check('the group bends', await ev(f"!!st.layerById('{fid}').t.pin2"))
        # (the pennant in a colour nothing else uses, so it can be counted)
        await ev("(()=>{const l=st.doc.layers.find(l=>l.name==='Pennant');l.b.fill='#00ff00';delete l.t.fill;SG.renderAll()})()")
        await ev("st.doc.ex.mode='css'"); css2=await ev("B.buildExport(null).code"); await ev("st.doc.ex.mode='js'")
        # the CSS export plays the content's own animation inside the triangles (the copies run their
        # own CSS animations, so this plays it live instead of seeking): the pennant fades in
        async def pennant(code, wait):
            q=await b.new_page(); await q.set_viewport_size({'width':640,'height':400})
            await q.set_content('<!doctype html><html><body style="margin:0;width:640px">'+code+'</body></html>'); await q.wait_for_timeout(wait)
            img=await q.screenshot(); await q.close()
            q=await b.new_page(); await q.set_content('<canvas id=c></canvas>')
            n=await q.evaluate("""async(src)=>{const im=new Image();im.src=src;await im.decode();const c=document.getElementById('c');c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);const d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]<70&&d[i+1]>200&&d[i+2]<70)n++;return n}""",'data:image/png;base64,'+base64.b64encode(img).decode())
            await q.close(); return n
        early=await pennant(css2,100); late=await pennant(css2,1700)
        check('a bent group plays its own animation (CSS export)', early<10 and late>40, (early,late))
        # ---- removing all pins draws the image as before
        await ev(f"hi.select('{iid}')"); await pg.wait_for_timeout(150)
        await pg.click('[data-act="pinrmall"]'); await pg.wait_for_timeout(200)
        check('Remove all pins drops the mesh', await ev(f"!{L}.pins && !{L}.mesh && !document.getElementById('e-{iid}-mesh')"))
        # ---- the Export dialog: in CSS mode a note offers the much smaller JavaScript export
        await ev("st.doc.ex.mode='css'; B.openExport()"); await pg.wait_for_timeout(1200)
        note=await ev("(()=>{const n=document.getElementById('xShapeNote');return n.hidden?null:n.textContent})()")
        stats=await ev("document.getElementById('xFileSub').textContent")
        check('CSS mode: a note offers JavaScript', note is not None and 'times smaller' in note and 'as JavaScript' in stats, (note,stats))
        await pg.screenshot(path=OUT+'pin-mesh-export.png')
        await pg.click('#xUseJS'); await pg.wait_for_timeout(1200)
        check('Use JavaScript switches the export', await ev("st.doc.ex.mode")=='js' and await ev("document.getElementById('xShapeNote').hidden"))
        R['errors']=errs; check('no page errors', not errs, errs)
        print(json.dumps(R,indent=1)); print('FAILS',F); await b.close()
asyncio.run(main())
