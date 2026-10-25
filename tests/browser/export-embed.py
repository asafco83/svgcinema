import asyncio, sys, json, os, tempfile
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Export › Include the editable project: off by default, shows what it adds, and an SVG exported with
# it opens as exactly the same project (re-exporting gives the same file), or adds its layers.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page()
        await pg.set_viewport_size({'width':1440,'height':900}); pg.set_default_timeout(8000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/'), wait_until='domcontentloaded'); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.bx=await import('/src/export/build.ts'); window.as=await import('/src/io/assets.ts'); }")
        ev=lambda js, a=None: pg.evaluate(js, a); R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        await pg.click('#bExport'); await pg.wait_for_timeout(1200)
        check('the option is off by default', not await ev("document.getElementById('xProj').checked"))
        kb=await ev("document.getElementById('xProjKb').textContent")
        check('it shows what it adds to the file', kb.startswith('+') and 'KB' in kb, kb)
        check('without it the SVG has no project inside', 'svgcinema-project' not in await ev("bx.buildExport(null).code"))
        if await pg.is_hidden('#xProj'): await pg.click('#xSecAdv > h3')   # Advanced starts closed
        await pg.click('#xProj'); await pg.wait_for_timeout(800)
        check('ticking it is remembered in the project', await ev("st.doc.ex.proj===true"))
        check('its note shows', not await ev("document.getElementById('xProjNote').hidden"))
        code=await ev("bx.buildExport(null).code")
        check('the SVG carries the project', '<svgcinema-project' in code)
        await pg.keyboard.press('Escape'); await ev("document.getElementById('mExport').hidden=true")
        before=await ev("({n:st.doc.layers.length, names:st.doc.layers.map(l=>l.name), tracks:st.doc.layers.reduce((s,l)=>s+Object.keys(l.t).length,0)})")
        path=os.path.join(tempfile.mkdtemp(),'sunrise.svg'); open(path,'w').write(code)
        # open it: the same project
        await ev("st.doc.layers=[]; hi.commit({insp:true})")
        await pg.set_input_files('#fProj', path); await pg.wait_for_timeout(1500)
        after=await ev("({n:st.doc.layers.length, names:st.doc.layers.map(l=>l.name), tracks:st.doc.layers.reduce((s,l)=>s+Object.keys(l.t).length,0)})")
        check('opening it brings back every layer and track', after==before, (before['n'],after['n'],before['tracks'],after['tracks']))
        check('no import report (nothing was converted)', await ev("document.getElementById('mImpRep').hidden"))
        again=await ev("bx.buildExport(null).code")
        check('exporting it again gives the same file', again==code, (len(code), len(again)))
        # add it to another project: its layers in a group, with new ids
        await ev("st.doc.layers=st.doc.layers.slice(0,3); hi.commit({insp:true})")
        n0=await ev("st.doc.layers.length")
        await ev(f"(()=>{{const a=as.addAsset({{kind:'svg',name:'sunrise',mime:'image/svg+xml',text:{json.dumps(code)},data:'',size:1}}); as.placeAsset(a,null)}})()")
        await pg.wait_for_timeout(1200)
        r=await ev("(()=>{const w=st.doc.layers.find(l=>l.name==='sunrise');const ids=st.doc.layers.map(l=>l.id);return {wrap:!!w, n:st.doc.layers.length, unique:new Set(ids).size===ids.length}})()")
        check('adding it puts its layers in a group, with ids of their own', r['wrap'] and r['unique'] and r['n']==n0+1+before['n'], (r, n0, before['n']))
        await pg.screenshot(path=OUT+'export-embed.png')
        R['errors']=errs; print(json.dumps(R,indent=1)); print('FAILS',F+(['errors'] if errs else []))
        await b.close()
asyncio.run(main())
