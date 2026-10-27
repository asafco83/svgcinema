import asyncio, sys, json
from playwright.async_api import async_playwright
import os
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Bones step 1: a new bone is keyed on Rotate; bone scale runs along / across the bone (editor, JS and
# CSS export agree); CSS export animates shapes with SMIL (plays in Safari), hover keeps d: path().
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(); await pg.set_viewport_size({'width':1440,'height':1000})
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.K=await import('/src/core/constants.ts'); window.B=await import('/src/export/build.ts'); window.BO=await import('/src/tools/bones.ts'); window.SG=await import('/src/render/stage.ts')}")
        ev=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        byName=lambda n: f"st.doc.layers.find(l=>l.name==='{n}')"

        # 1. new bones get a Rotate key at 0 s holding the rest value
        await ev("hi.setTime(1)")
        await ev("BO.boneCreate({x:80,y:320}); st.S.drag.move({x:140,y:320},{}); st.S.drag.up()")
        nb=await ev("(()=>{const l=st.layerById(st.S.sel);return l&&l.type==='bone'?JSON.stringify(l.t.rot):null})()")
        check('drawn bone: Rotate key at 0 s', nb=='[[0,0,"linear"]]', nb)
        await ev(f"BO.addChildBone({byName('Stem 3')})")
        cb=await ev("JSON.stringify(st.layerById(st.S.sel).t.rot)")
        check('child bone: Rotate key at 0 s', cb=='[[0,0,"linear"]]', cb)
        await ev("hi.undo(); hi.undo()")
        check('undo removes both bones', await ev("st.doc.layers.filter(l=>l.type==='bone').length")==3)

        # 2. bone scale in the bone's own frame: Stem points up (-90°), so W stretches the stalk vertically
        stalk=await ev(f"{byName('Stalk')}.id")
        # the stalk's screen matrix: x runs across the bone, y along it (the bone points up)
        rect=lambda: ev(f"(()=>{{const M=document.getElementById('e-{stalk}-s').getScreenCTM();return [Math.hypot(M.a,M.b),Math.hypot(M.c,M.d)]}})()")
        await ev("hi.setTime(1.2)"); await ev("SG.frame()"); w0,h0=await rect()
        await ev(f"{byName('Stem')}.b.scl=[2,1]; SG.frame()"); w1,h1=await rect()
        check('W scales along the bone', abs(h1/h0-2)<0.02 and abs(w1/w0-1)<0.02, (w0,h0,w1,h1))
        await ev(f"{byName('Stem')}.b.scl=[1,2]; SG.frame()"); w2,h2=await rect()
        check('H scales across the bone', abs(h2/h0-1)<0.02 and abs(w2/w0-2)<0.02, (w0,h0,w2,h2))
        await ev(f"{byName('Stem')}.b.scl=[1,1]; SG.frame()")

        # exports agree with the editor: animate Stem's scale non-uniformly, compare at 1.2 s (the Sprout has grown in, no sway yet)
        await ev(f"{byName('Stem')}.t.scl=[[0,[1,1],'linear'],[1.6,[1.8,0.6],'linear']]")
        await ev("st.doc.ex.mode='js'; st.doc.ex.trigger='load'"); js=await ev("B.buildExport(null).code")
        check('JS export carries the rest angle', '"ba":-90' in js)
        await ev("st.doc.ex.mode='css'"); css=await ev("B.buildExport(null).code")
        check('CSS keyframes write the bone frame', 'rotate(-90deg) scale(' in css)
        await ev("hi.setTime(1.2); SG.frame()"); ed=await rect()
        morph=await ev("(()=>{const l=st.doc.layers.find(l=>l.t.d&&l.t.d.length>1);return l?l.id:null})()")
        mt=await ev(f"(()=>{{const l=st.layerById('{morph}');return (l.t.d[0][0]+l.t.d[1][0])/2}})()")

        async def probe(code, mode, t):
            q=await b.new_page(); await q.set_viewport_size({'width':1440,'height':1000})
            await q.set_content('<!doctype html><html><body style="margin:0">'+code+'</body></html>'); await q.wait_for_timeout(400)
            if mode=='js': await q.evaluate(f"document.querySelector('svg').player.pause().seekTo({t*1000})")
            else: await q.evaluate(f"(()=>{{const s=document.querySelector('svg');s.pauseAnimations();s.setCurrentTime({t});document.getAnimations().forEach(a=>{{a.pause();a.currentTime={t*1000}}})}})()")
            await q.wait_for_timeout(100)
            r=await q.evaluate(f"(()=>{{const P=document.querySelector('svg').id.replace(/svg$/,''),K=document.getElementById(P+'{stalk}-s').getScreenCTM(),m=document.getElementById(P+'{morph}-s').getBBox();return [Math.hypot(K.a,K.b),Math.hypot(K.c,K.d),m.x,m.y,m.width,m.height]}})()")
            await q.screenshot(path=OUT+f'bones-{mode}.png'); await q.close(); return r
        rj=await probe(js,"js",1.2); rc=await probe(css,"css",1.2)
        check('JS and CSS bone scale match', abs(rj[0]-rc[0])<0.01 and abs(rj[1]-rc[1])<0.01, (rj[:2],rc[:2]))
        check('JS export bone scale matches the editor', abs(rj[1]/rj[0]-ed[1]/ed[0])<0.01, (rj[:2],ed))

        # 3. CSS export animates shapes with SMIL
        check('CSS load: shape as SMIL, no d: path()', '<animate xlink:href=' in css and 'attributeName="d"' in css and 'd:path(' not in css)
        jm=await probe(js,'js',mt); cm=await probe(css,'css',mt)
        check('SMIL morph matches the JS player mid-morph', all(abs(jm[i]-cm[i])<0.6 for i in range(2,6)), (mt, jm[2:], cm[2:]))
        c0=await probe(css,'css',0)
        check('SMIL morph actually moves', any(abs(c0[i]-cm[i])>2 for i in range(2,6)), (c0[2:], cm[2:]))
        await ev("st.doc.ex.trigger='hover'"); hv=await ev("B.buildExport(null).code")
        check('CSS hover keeps d: path()', 'd:path(' in hv and 'attributeName="d"' not in hv)
        await ev("st.doc.ex.mode='js'; st.doc.ex.trigger='load'")
        R['errors']=errs; check('no page errors', not errs, errs)
        print(json.dumps(R,indent=1)); print('FAILS',F); await b.close()
asyncio.run(main())
