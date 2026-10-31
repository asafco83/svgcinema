import asyncio, sys, json, os, subprocess, tempfile, http.server, threading, functools
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The editor as an installable app (app/pwa, public/manifest.webmanifest, public/sw.js):
# - the manifest: name, standalone, icons (they load), .SVGcinema files handled;
# - a production build registers the service worker, which keeps the editor: offline, it still opens;
# - a practice editor registers nothing;
# - a .SVGcinema file the app is opened with opens as the project, keeping its handle (Save writes back to it).
ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
async def main():
    dev=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/'
    R={}; F=[]
    def check(n,c,i=None):
        R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
        if not c: F.append(n)
    m=json.load(open(os.path.join(ROOT,'public/manifest.webmanifest')))
    check('manifest: name, standalone, start and scope', m['name']=='SVGcinema' and m['display']=='standalone' and m['start_url']=='./' and m['scope']=='./', m['name'])
    check('manifest: icons 192, 512 and maskable, all there', {i['sizes']+i['purpose'] for i in m['icons']}=={'192x192any','512x512any','512x512maskable'} and all(os.path.exists(os.path.join(ROOT,'public',i['src'])) for i in m['icons']))
    check('manifest: opens .SVGcinema files', m['file_handlers'][0]['accept']=={'application/x-svgcinema-project':['.svgcinema']})
    # a production build of its own, served here
    d=tempfile.mkdtemp()
    subprocess.run(['npx','vite','build','--outDir',d,'--emptyOutDir'],cwd=ROOT,check=True,capture_output=True)
    pc=json.load(open(os.path.join(d,'sw-precache.json')))
    check('the build lists what the service worker keeps (no maps, no encoders\' wasm, no clips)', 'index.html' in pc['files'] and pc['build'] and not any(f.endswith(('.map','.wasm','.mp4')) for f in pc['files']), len(pc['files']))
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*a): pass
    srv=http.server.ThreadingHTTPServer(('127.0.0.1',5302),functools.partial(Quiet,directory=d))
    threading.Thread(target=srv.serve_forever,daemon=True).start()
    async with async_playwright() as p:
        b=await p.chromium.launch()
        errs=[]
        c=await b.new_context(viewport={'width':1440,'height':900})
        pg=await c.new_page(); pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto('http://127.0.0.1:5302/'); await pg.wait_for_timeout(1500)
        ok=await pg.evaluate("Promise.race([navigator.serviceWorker.ready.then(r=>!!r.active),new Promise(r=>setTimeout(()=>r(false),8000))])")
        await pg.wait_for_timeout(2500)
        check('a production build registers the service worker', ok)
        check('the page links the manifest and the theme colour', await pg.evaluate("!!document.querySelector('link[rel=manifest]') && !!document.querySelector('meta[name=theme-color]')"))
        await pg.reload(); await pg.wait_for_timeout(1500)
        await c.set_offline(True)
        await pg.reload(); await pg.wait_for_timeout(2500)
        check('offline, the editor still opens', await pg.evaluate("!!document.getElementById('tools') && document.querySelectorAll('#tools button').length>3 && !!document.getElementById('bExport')"))
        await c.set_offline(False)
        await pg.goto('http://127.0.0.1:5302/?tour=keyframes'); await pg.wait_for_timeout(1500)
        await c.close()
        c=await b.new_context(viewport={'width':1440,'height':900}); pg=await c.new_page()
        await pg.goto('http://127.0.0.1:5302/?tour=keyframes'); await pg.wait_for_timeout(2500)
        check('a practice editor registers no service worker', await pg.evaluate("navigator.serviceWorker.getRegistrations().then(r=>r.length===0)"))
        await c.close()
        # the launch: a .SVGcinema file handed to the app (dev server: the module itself)
        c=await b.new_context(viewport={'width':1440,'height':900}); pg=await c.new_page(); pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto(dev); await pg.wait_for_timeout(2000)
        r=await pg.evaluate("""async()=>{const st=await import('/src/core/state.ts');const z=await import('/src/io/zip.ts');const pwa=await import('/src/app/pwa.ts');
          st.doc.name='From the app';const blob=await z.buildProject(true,[]);st.S.dirty=false;
          const o=await import('/src/io/open.ts');o.applyProject(st.blankDoc(640,400),{},null);st.S.dirty=false;
          const f=new File([blob],'Launched.SVGcinema');const h={kind:'file',name:'Launched.SVGcinema',getFile:async()=>f};
          const ok=await pwa.openLaunchFiles([h]);return [ok,st.doc.name,st.S.file&&st.S.file.name,!!(st.S.file&&st.S.file.handle===h)]}""")
        check('a .SVGcinema file the app opens with becomes the project, and Save writes back to it', r[0] and r[2]=='Launched.SVGcinema' and r[3], r)
        await c.close()
        await b.close()
    srv.shutdown()
    R['errors']=errs; print(json.dumps(R,indent=1)); print('FAILS',F+(['errors'] if errs else []))
asyncio.run(main())
