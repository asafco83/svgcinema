import asyncio, sys, json, math
from playwright.async_api import async_playwright
import os
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Bones step 3: the Scale bone tool (S): modes, Volume, Tab, Shift, Scale keyed at the playhead; Inherit
# scale (child bones ride the stretched tip unstretched unless it's on), in the editor and both exports.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(); await pg.set_viewport_size({'width':1440,'height':1000})
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ localStorage.removeItem('svgcinema:boneScale'); window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.BO=await import('/src/tools/bones.ts'); window.D=await import('/src/core/dom.ts'); window.B=await import('/src/export/build.ts'); window.K=await import('/src/core/constants.ts')}")
        ev=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        ID={}
        for n in ['Stem','Stem 2','Stem 3','Stalk 2']: ID[n]=await ev(f"st.doc.layers.find(l=>l.name==='{n}').id")
        L=lambda n: f"st.layerById('{ID[n]}')"
        await ev("window.scr=(x,y)=>{const M=D.CONTENT.getScreenCTM();return [M.a*x+M.c*y+M.e, M.b*x+M.d*y+M.f]}")
        bp=lambda n: ev(f"(()=>{{const q=BO.bonePts({L(n)});return {{J:[q.J.x,q.J.y],T:[q.T.x,q.T.y],j:scr(q.J.x,q.J.y),t:scr(q.T.x,q.T.y),len:Math.hypot(q.T.x-q.J.x,q.T.y-q.J.y)}}}})()")
        scl=lambda n: ev(f"JSON.stringify({L(n)}.t.scl||null)")
        async def drag(a,c,shift=False,tab_mid=False):
            await pg.mouse.move(a[0],a[1]); await pg.mouse.down()
            if shift: await pg.keyboard.down('Shift')
            await pg.mouse.move((a[0]+c[0])/2,(a[1]+c[1])/2,steps=3)
            if tab_mid: await pg.keyboard.press('Tab')
            await pg.mouse.move(c[0],c[1],steps=3)
            if shift: await pg.keyboard.up('Shift')
            await pg.mouse.up(); await pg.wait_for_timeout(150)
        # the screen direction of a bone and a point on it
        def along(q,f): return [q['j'][0]+(q['t'][0]-q['j'][0])*f, q['j'][1]+(q['t'][1]-q['j'][1])*f]
        def ext(q,f):
            dx,dy=q['t'][0]-q['j'][0],q['t'][1]-q['j'][1]; return [q['j'][0]+dx*f,q['j'][1]+dy*f]

        await ev("hi.setTime(1.9)"); await pg.wait_for_timeout(100)
        await pg.click('#tools [data-group="bones"]', button='right'); await pg.wait_for_timeout(200)
        items=await ev("[...document.querySelectorAll('#toolfly .tf-item')].map(b=>b.dataset.tool+':'+b.querySelector('kbd').textContent)")
        check('flyout order with Scale bone (S)', items==['bone:B','boneedit:E','bonescale:S','bonebind:'], items)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(80)
        await pg.keyboard.press('s'); await pg.wait_for_timeout(150)
        check('S picks the Scale bone tool', await ev("st.S.tool")=='bonescale')
        bar=await ev("(()=>{const b=document.getElementById('boneOpts');return b.hidden?null:[...b.querySelectorAll('[data-bsm]')].map(x=>x.textContent+(x.classList.contains('on')?'*':''))})()")
        check('options bar with the four modes, Length first', bar==['Length*','Thickness','Linked','Squash & stretch'], bar)
        check('no Volume outside squash', await ev("!document.getElementById('bsVol')"))

        # ---- Length: drag Stem 2 out along itself to 150%; its child keeps its length
        s2=await bp('Stem 2'); s3=await bp('Stem 3')
        await drag(along(s2,1.0), ext(s2,1.5))
        tr=json.loads(await scl('Stem 2'))
        check('Scale keyed at the playhead', tr and len(tr)==1 and abs(tr[0][0]-1.9)<1e-6 and abs(tr[0][1][0]-1.5)<0.03 and tr[0][1][1]==1, tr)
        s2b=await bp('Stem 2'); s3b=await bp('Stem 3')
        check('length: the bone is longer', abs(s2b['len']/s2['len']-1.5)<0.04, (s2['len'],s2b['len']))
        check('child bone rides the tip unstretched', abs(s3b['len']-s3['len'])<0.3 and math.hypot(s3b['J'][0]-s2b['T'][0],s3b['J'][1]-s2b['T'][1])<0.6, (s3['len'],s3b['len']))
        stalk=await ev(f"(()=>{{const r=document.getElementById('e-{ID['Stalk 2']}-s').getBoundingClientRect();return r.height}})()")
        await pg.screenshot(path=OUT+'bone-scale.png')
        # ---- exports agree (Stem 2 is scaled, Stem 3 cancels it)
        await ev("st.doc.ex.mode='js'; st.doc.ex.trigger='load'"); js=await ev("B.buildExport(null).code")
        check('JS export: child cancels the parent scale', '"cs":1' in js and '"ba":-90' in js)
        await ev("st.doc.ex.mode='css'"); css=await ev("B.buildExport(null).code")
        await ev("st.doc.ex.mode='js'")
        async def probe(code, mode, t):
            q=await b.new_page(); await q.set_viewport_size({'width':1440,'height':1000})
            await q.set_content('<!doctype html><html><body style="margin:0">'+code+'</body></html>'); await q.wait_for_timeout(300)
            if mode=='js': await q.evaluate(f"document.querySelector('svg').player.pause().seekTo({t*1000})")
            else: await q.evaluate(f"(()=>{{const s=document.querySelector('svg');s.pauseAnimations();s.setCurrentTime({t});document.getAnimations().forEach(a=>{{a.pause();a.currentTime={t*1000}}})}})()")
            await q.wait_for_timeout(80)
            r=await q.evaluate(f"(()=>{{const P=document.querySelector('svg').id.replace(/svg$/,''),M=document.getElementById(P+'{ID['Stem 3']}-s').getScreenCTM(),N=document.getElementById(P+'{ID['Stem 2']}-s').getScreenCTM();return [Math.hypot(M.c,M.d),Math.hypot(M.a,M.b),Math.hypot(N.c,N.d),Math.hypot(N.a,N.b)]}})()")
            await q.close(); return r
        rj=await probe(js,'js',1.9); rc=await probe(css,'css',1.9)
        check('JS and CSS agree on both bones', all(abs(x-y)<0.01 for x,y in zip(rj,rc)), (rj,rc))
        own=await ev(f"K.H.get({L('Stem 3')},'scl',1.9)")
        # the child keeps only its own scale (along / across = its own W / H), the parent is stretched
        check('exported child is unstretched, parent stretched', abs(rj[0]/rj[1]-own[0]/own[1])<0.01 and abs(rj[2]/rj[3]-1.5)<0.04, (rj, own))
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(150)
        check('undo removes the scale key', await scl('Stem 2')=='null')

        # ---- Thickness (button), Squash Area / Tube, Shift 10%, Tab mid-drag
        await pg.click('#boneOpts [data-bsm="thickness"]'); await pg.wait_for_timeout(80)
        s2=await bp('Stem 2'); m=along(s2,0.25); dx,dy=s2['t'][0]-s2['j'][0],s2['t'][1]-s2['j'][1]; l=math.hypot(dx,dy); nx,ny=-dy/l,dx/l
        await drag([m[0],m[1]],[m[0]+nx*l*0.25,m[1]+ny*l*0.25])
        v=(json.loads(await scl('Stem 2')) or [[0,[0,0]]])[0][1]
        check('thickness changes H only', v[0]==1 and v[1]>1.3, v)
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(120)
        await pg.click('#boneOpts [data-bsm="squash"]'); await pg.wait_for_timeout(80)
        check('Volume shows for squash & stretch', await ev("!!document.getElementById('bsVol')"))
        s2=await bp('Stem 2')
        await drag(along(s2,1.0), ext(s2,1.25), shift=True)
        v=(json.loads(await scl('Stem 2')) or [[0,[0,0]]])[0][1]
        check('squash keeps the area, Shift snaps W to 10%', abs(v[0]*10-round(v[0]*10))<1e-9 and v[0]>1.1 and abs(v[0]*v[1]-1)<0.01, v)
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(120)
        await pg.select_option('#bsVol','tube'); await pg.wait_for_timeout(80)
        s2=await bp('Stem 2')
        await drag(along(s2,1.0), ext(s2,1.25), shift=True)
        v=(json.loads(await scl('Stem 2')) or [[0,[0,0]]])[0][1]
        check('tube keeps length × thickness²', abs(v[0]*10-round(v[0]*10))<1e-9 and v[0]>1.1 and abs(v[0]*v[1]*v[1]-1)<0.01, v)
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(120)
        await pg.click('#boneOpts [data-bsm="length"]'); await pg.wait_for_timeout(80)
        s2=await bp('Stem 2')
        await drag(along(s2,1.0), ext(s2,1.4), tab_mid=True)
        check('Tab switches the mode while dragging', await ev("st.S.boneScaleMode")=='thickness')
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(120)
        check('mode and volume are remembered', await ev("JSON.parse(localStorage.getItem('svgcinema:boneScale')).vol")=='tube')

        # ---- Inherit scale: on the child bone only; on, the child stretches with its parent
        await ev(f"hi.select('{ID['Stem']}')"); await pg.wait_for_timeout(100)
        check('no Inherit scale on a root bone', await ev("!document.getElementById('fl-inh')"))
        await ev(f"hi.select('{ID['Stem 3']}')"); await pg.wait_for_timeout(100)
        check('Inherit scale on a child bone, off by default', await ev("!!document.getElementById('fl-inh') && !document.getElementById('fl-inh').checked"))
        check('W/H note in Transforms for bones (the Scale label’s tooltip)', await ev("[...document.querySelectorAll('#insp .rl')].some(r=>r.textContent.trim()==='Scale' && /W along the bone/.test((r.querySelector('.itip')||{}).title||''))"))
        await pg.screenshot(path=OUT+'bone-inspector.png', clip={'x':1144,'y':52,'width':296,'height':760})
        await pg.click('#fl-inh'); await pg.wait_for_timeout(150)
        check('Inherit scale turns on', await ev(f"{L('Stem 3')}.inh===true"))
        await ev(f"(()=>{{const l={L('Stem 2')};l.b.scl=[1.5,1];}})()"); await ev("(async()=>{(await import('/src/render/stage.ts')).frame()})()"); await pg.wait_for_timeout(100)
        s3b=await bp('Stem 3')
        await ev(f"{L('Stem 3')}.inh=false"); await ev("(async()=>{(await import('/src/render/stage.ts')).frame()})()"); await pg.wait_for_timeout(100)
        s3c=await bp('Stem 3')
        check('inheriting: the child stretches too', s3b['len']>s3c['len']*1.2, (s3b['len'],s3c['len']))
        R['errors']=errs; check('no page errors', not errs, errs)
        print(json.dumps(R,indent=1)); print('FAILS',F); await b.close()
asyncio.run(main())
