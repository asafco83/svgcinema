import asyncio, sys, json, os, re
from playwright.async_api import async_playwright
import os
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
FX=OUT+'fonts/ex/'
async def font_route(route):
    url=route.request.url
    m=re.search(r'@fontsource/([a-z0-9-]+)@([0-9.]+)/files/(.+)$',url)
    if m:
        p=f"{FX}fontsource-{m.group(1)}-{m.group(2)}/package/files/{m.group(3)}"
        if os.path.exists(p):
            return await route.fulfill(path=p, headers={'access-control-allow-origin':'*','content-type':'font/woff2' if p.endswith('2') else 'font/woff'})
    await route.fulfill(status=404, body='')
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(device_scale_factor=1)
        await pg.set_viewport_size({'width':1440,'height':1000}); pg.set_default_timeout(6000)
        await pg.route('https://cdn.jsdelivr.net/**', font_route)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/'), wait_until='domcontentloaded'); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.K=await import('/src/core/constants.ts'); window.B=await import('/src/export/build.ts'); window.OV=await import('/src/render/overlay.ts')}")
        ev=lambda js: pg.evaluate(js); R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        await ev("hi.setTime(2)")
        tid=await ev("st.doc.layers.find(l=>l.name==='Title').id"); L=f"st.layerById('{tid}')"
        await ev(f"hi.select('{tid}')")
        rows=await ev("(()=>{const s=[...document.querySelectorAll('#insp .sec')].find(s=>s.querySelector('h3').textContent.startsWith('Transforms'));return [...s.querySelectorAll('.rl')].map(r=>r.textContent)})()")
        check('transform order', rows==['Position','Scale','Skew','Rotate','Origin','Anchor'], rows)
        mp=await ev("(()=>{const s=[...document.querySelectorAll('#insp .sec')].find(s=>s.querySelector('h3').textContent.startsWith('Motion path'));const r=s && s.children[1];return r && (r.id || (r.querySelector('select')||{}).id)})()")
        check('motion path picker first in its section', mp=='motionPath', mp)
        check('no picker in text section', await ev("!document.querySelector('#insp .sec #motionPath').closest('.sec').querySelector('textarea')"))
        sun=await ev("st.doc.layers.find(l=>l.name==='Sun').id")
        await pg.select_option('#motionPath', sun)
        n=await ev(f"{L}.t.pos.length")
        check('one key per node (+closing)', n==5, n)
        box=await ev(f"OV.boxOf(st.layerById('{sun}'))")
        pb=await ev("(()=>{const p=document.querySelector('#overlay .ov-path').getAttribute('points').split(' ').map(s=>s.split(',').map(Number));const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}})()")
        check('path sits on the shape', all(abs(box[k]-pb[k])<1.5 for k in 'xywh'), (box,pb))
        # origin of layer at current time on the path
        org=await ev(f"(()=>{{const l={L},c=K.H.comp(l,st.S.time);return [c.x,c.y]}})()")
        R['org']=org
        check('orient toggle next to rotate', await ev("!!document.querySelector('[data-kb=rot]').parentElement.querySelector('[data-act=orient]')"))
        await pg.click('[data-act=orient]')
        check('orient toggles', await ev(f"{L}.or===true"))
        # drag segment 0
        await ev("hi.setTime(0.1)")
        pt=await ev("(()=>{const s=document.querySelector('#overlay [data-mseg=\"0\"]'),L=s.getTotalLength(),q=s.getPointAtLength(L/2),m=s.getScreenCTM();const r=new DOMPoint(q.x,q.y).matrixTransform(m);return [r.x,r.y]})()")
        h0=await ev(f"JSON.stringify({L}.t.pos[0][3])")
        await pg.mouse.move(pt[0],pt[1]); await pg.mouse.down(); await pg.mouse.move(pt[0]+20,pt[1]+20,steps=4); await pg.mouse.move(pt[0]+40,pt[1]+40,steps=4); await pg.mouse.up()
        h1=await ev(f"JSON.stringify({L}.t.pos[0][3])")
        check('drag segment curves it', h1!=h0 and h1!='null', (h0,h1))
        check('layer did not move', await ev(f"st.S.sel==='{tid}'"))
        check('handles shown', await ev("document.querySelectorAll('#overlay .ov-mh').length")>=2)
        # drag a handle
        hp=await ev("(()=>{const c=document.querySelector('#overlay [data-mh=\"0,0\"]'),r=c.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
        await pg.mouse.move(hp[0],hp[1]); await pg.mouse.down(); await pg.mouse.move(hp[0]+15,hp[1],steps=3); await pg.mouse.up()
        h2=await ev(f"JSON.stringify({L}.t.pos[0][3])")
        check('drag handle changes curve', h2!=h1, (h1,h2))
        # double click straightens
        pt=await ev("(()=>{const s=document.querySelector('#overlay [data-mseg=\"0\"]'),L=s.getTotalLength(),q=s.getPointAtLength(L/2),m=s.getScreenCTM();const r=new DOMPoint(q.x,q.y).matrixTransform(m);return [r.x,r.y]})()")
        await pg.mouse.dblclick(pt[0],pt[1])
        h3=await ev(f"JSON.stringify({L}.t.pos[0][3]||null)")
        R['after dblclick']=h3
        # selected keys move together: nudge and drag
        await ev(f"(()=>{{st.S.keys=new Set({L}.t.pos); hi.commit({{insp:true}})}})()")
        before=await ev(f"{L}.t.pos.map(q=>q[1].slice())")
        await pg.mouse.click(5,500)  # nothing? click empty canvas area deselects; use evaluate instead
        await ev(f"(()=>{{hi.select('{tid}'); st.S.keys=new Set({L}.t.pos); st.S.kbArea='stage'; document.activeElement.blur()}})()")
        await pg.keyboard.press('ArrowRight'); await pg.keyboard.press('Shift+ArrowDown')
        after=await ev(f"{L}.t.pos.map(q=>q[1])")
        check('arrow nudges all selected position keys', all(abs(a[0]-b0[0]-1)<1e-6 and abs(a[1]-b0[1]-10)<1e-6 for a,b0 in zip(after,before)), (before[:2],after[:2]))
        await ev(f"(()=>{{st.S.keys=new Set([{L}.t.pos[1]]); st.S.kbArea='timeline'}})()")
        t0=await ev(f"{L}.t.pos.map(q=>q[0])"); await pg.keyboard.press('ArrowRight'); t1=await ev(f"{L}.t.pos.map(q=>q[0])")
        check('in the timeline arrows still shift time', t1!=t0, (t0[:2],t1[:2]))
        await pg.keyboard.press('Control+z')
        await ev(f"(()=>{{st.S.keys=new Set({L}.t.pos); st.S.kbArea='stage'}})()")
        await ev(f"(()=>{{delete {L}.or; hi.commit({{insp:true}})}})()")
        before=await ev(f"{L}.t.pos.map(q=>q[1].slice())")
        tb=await ev(f"(()=>{{const r=document.getElementById('e-{tid}-s').getBoundingClientRect();return [r.x+r.width*0.2,r.y+r.height/2]}})()")
        print('dbg', await ev(f"(()=>{{const e=document.elementFromPoint({tb[0]},{tb[1]});return e.tagName+' '+e.getAttribute('class')+' '+(e.closest('[data-lid]')||{{}}).id+' keys '+st.S.keys.size+' '+(document.activeElement||{{}}).tagName}})()"))
        await pg.mouse.move(tb[0],tb[1]); await pg.mouse.down(); await pg.mouse.move(tb[0]+30,tb[1],steps=5); await pg.mouse.up()
        print('dbg2', await ev("st.S.keys.size+' '+st.S.sel+' '+!!document.querySelector('.cin-tedit')"))
        after=await ev(f"{L}.t.pos.map(q=>q[1])")
        dx=[a[0]-b0[0] for a,b0 in zip(after,before)]
        check('drag moves all selected position keys', all(abs(d-dx[0])<0.01 for d in dx) and dx[0]>10, dx)
        # keep width does not move text (centered)
        await ev(f"(()=>{{st.S.keys=new Set(); hi.select('{tid}')}})()")
        await pg.click('[data-tx=anchor][data-v=middle]')
        r0=await ev(f"document.getElementById('e-{tid}-s').getBoundingClientRect().x")
        await pg.click('[data-tx=wrap]')
        r1=await ev(f"document.getElementById('e-{tid}-s').getBoundingClientRect().x")
        await pg.click('[data-tx=wrap]')
        r2=await ev(f"document.getElementById('e-{tid}-s').getBoundingClientRect().x")
        check('keep width toggle keeps the text in place', abs(r0-r1)<1.5 and abs(r0-r2)<1.5, (r0,r1,r2))
        # miter row and filter note
        labels=await ev("[...document.querySelectorAll('#insp .rl')].map(r=>r.textContent)")
        check('miter limit sits in the line join row', 'Miter limit' not in labels and await ev("!!document.getElementById('x-miter')"), labels)
        await pg.click('#fx-add'); await pg.click('#fxMenu [data-fxp=blur]')
        check('filters CSS note', 'CSS exports' in await ev("[...document.querySelectorAll('#insp .sec')].find(s=>s.querySelector('h3').textContent.startsWith('Filters')).textContent"))
        # fonts
        await pg.click('#g-family'); await pg.locator('#fontPop .fp-opt[data-font="Heebo"]').first.click()
        await pg.wait_for_timeout(800)
        # web fonts come from jsDelivr: without network these checks are skipped, not failed
        net=await ev("fetch('https://cdn.jsdelivr.net/npm/@fontsource/heebo@5.0.0/package.json').then(r=>r.ok,()=>false)")
        if not net:
            _check=check
            def check(n,c,i=None):
                if n.startswith('web font') or n.startswith('export: outlines') or n.startswith('export: embedded'): R[n]='skipped (no network to jsDelivr)'
                else: _check(n,c,i)
        check('web font loads in the editor', await ev("document.fonts.check('20px Heebo')"))
        fam=await ev(f"document.getElementById('e-{tid}-s').getAttribute('font-family')")
        check('font-family with fallback', fam=='Heebo, sans-serif', fam)
        sty=await ev("[...document.querySelectorAll('#tx-style option')].map(o=>o.value)")
        check('style list follows the font', all(v.endswith('|0') for v in sty) and len(sty)==9, sty)
        await ev("B.openExport()"); await pg.wait_for_timeout(1500)
        check('fonts row visible', await ev("!document.getElementById('xFontRow').hidden"))
        prev=await ev("document.getElementById('xprev').innerHTML")
        check('export: outlines', '<text' not in prev.split('Good morning')[0][-400:] and prev.count('<path')>3 and 'Good morning' not in prev, prev.count('<text'))
        await pg.click('#xFonts [data-v=embed]'); await pg.wait_for_timeout(1500)
        prev=await ev("document.getElementById('xprev').innerHTML")
        check('export: embedded font', '@font-face' in prev and 'base64' in prev and 'Good morning' in prev)
        await pg.screenshot(path=OUT+'mp-export.png')
        await pg.keyboard.press('Escape')
        await ev(f"hi.select('{tid}')"); await pg.wait_for_timeout(200)
        await pg.screenshot(path=OUT+'mp-canvas.png')
        R['errors']=errs; print(json.dumps(R,indent=1)); print('FAILS',F)
        await b.close()
asyncio.run(main())
