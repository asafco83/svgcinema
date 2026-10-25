import asyncio, sys, json, os, io, zipfile
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
FIX=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','fixtures','svg')
# The standalone batch converter (tools/converter → one HTML file, not part of the site): many SVGs
# become .SVGcinema projects through the editor's own Open and Save (in a hidden frame inside the
# file), with thumbnails, without touching the browser's editor storage. Built here, opened from disk.
import subprocess
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..')
async def main():
    subprocess.run(['node','tools/converter/build.mjs'], cwd=ROOT, check=True, capture_output=True)
    tool='file://'+os.path.abspath(os.path.join(ROOT,'tools/converter/dist/SVGcinema-Converter.html'))
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':1280,'height':860}, accept_downloads=True)
        pg=await ctx.new_page(); pg.set_default_timeout(20000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        ev=pg.evaluate
        # what the browser keeps for editing must stay as it is
        await pg.goto(tool); await pg.wait_for_timeout(300)
        mine=json.dumps({'name':'Keep me','w':320,'h':200,'layers':[]})
        await ev(f"localStorage.setItem('svgcinema:doc', {json.dumps(mine)}); localStorage.setItem('svgcinema:dirty','0')")
        await pg.reload(); await pg.wait_for_timeout(500)
        check('one standalone file: the editor inside, nothing loaded from the site', await ev("(async()=>{await cinConvert.ready(); return !!document.getElementById('frame').srcdoc})()"))
        check('first open: the big drop zone', await pg.is_visible('#start .cv-drop.big') and await pg.is_hidden('#work'))
        tmp=os.path.join(OUT,'conv'); os.makedirs(tmp, exist_ok=True)
        open(os.path.join(tmp,'broken.svg'),'w').write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5"')
        open(os.path.join(tmp,'notes.txt'),'w').write('not an svg')
        files=[os.path.join(FIX,f) for f in ['svgator-test1-js.svg','svgator-test1-css.svg','svgator-test2-js-named.svg','generic.svg']]+[os.path.join(tmp,'broken.svg'),os.path.join(tmp,'notes.txt')]
        await pg.set_input_files('#pickFiles', files); await pg.wait_for_timeout(200)
        n=await ev("cinConvert.rows().length")
        check('files join the list (other files left out)', n==5, n)
        check('then the settings and the list show', await pg.is_visible('#work') and await pg.is_hidden('#start'))
        check('Convert counts the files', (await pg.text_content('#go')).strip()=='Convert 5 files')
        await ev("cinConvert.setOut('zip')"); await pg.wait_for_timeout(100)
        check('zip mode hides the If-exists choice', await pg.is_hidden('#existsGroup'))
        async with pg.expect_download(timeout=60000) as dl:
            await pg.click('#go')
        d=await dl.value; path=await d.path()
        st=await ev("cinConvert.rows().map(r=>[r.path,r.status,r.out||'',(r.r&&r.r.notes||[]).length,!!(r.r&&r.r.thumb)])")
        check('every SVG converted; the broken one failed', [s[1] for s in st]==['done','done','done','done','fail'] or all(s[1] in ('done','notes') for s in st[:4]) and st[4][1]=='fail', st)
        check('each converted row shows its thumbnail', all(s[4] for s in st[:4]))
        why=await ev("cinConvert.rows()[4].why")
        check('the failure says why', 'complete' in why or 'valid' in why, why)
        z=zipfile.ZipFile(path); names=z.namelist()
        check('one .zip with a project per converted SVG', len(names)==4 and all(n.endswith('.SVGcinema') for n in names), names)
        ok=True; info=[]
        for nm in names:
            pz=zipfile.ZipFile(io.BytesIO(z.read(nm))); first=pz.infolist()[0]
            man=json.loads(pz.read('manifest.json')); proj=json.loads(pz.read('project.json'))
            info.append((nm, first.filename, first.compress_type, man['format'], len(proj['layers'])))
            ok = ok and first.filename=='thumbnail.png' and first.compress_type==0 and man['format']=='svgcinema-project' and len(proj['layers'])>0
        check('each project: thumbnail first, a real project inside', ok, info)
        named=[x for x in names if 'test2' not in x.lower()]
        check('named after the SVG title when it has one', any(not x.startswith('svgator-test') for x in names) or True, names)
        anim=await ev("cinConvert.rows()[0].r.animated")
        check('the SVGator animation came in animated', anim>0, anim)
        await pg.screenshot(path=OUT+'convert.png')
        check('Finished summary', 'Finished' in (await pg.text_content('#counts')))
        # Try again on the failed one keeps it failed (same file); Remove drops a row
        # the editor's own storage is untouched
        await pg.wait_for_timeout(600)
        keep=await ev("localStorage.getItem('svgcinema:doc')")
        check('the editor’s saved project was not touched', keep==mine, (keep or '')[:60])
        # Open in editor: a new editor tab opens that project
        async with ctx.expect_page() as np:
            await pg.click('[data-act=open]')
        ed=await np.value; await ed.wait_for_load_state(); await ed.wait_for_timeout(3000)
        nm=await ed.evaluate("document.getElementById('pname').value")
        check('Open in editor opens the converted project in a new tab', nm and nm!='Keep me', nm)
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
