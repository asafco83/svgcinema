import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Player › External: the SVG carries its animation as JSON and links the player file
# (player/cin-player.min.js, built by scripts/build-player.mjs); it plays exactly like the embedded
# player, standalone and inline (several on one page), and the Export preview plays it too.
async def main():
    base=(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1280,'height':860}); pg.set_default_timeout(10000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        await pg.goto(base); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.B=await import('/src/export/build.ts'); window.fo=await import('/src/render/fonts.ts'); }")
        ev=pg.evaluate
        url=base+'player/cin-player.min.js'
        codes=await ev(f"""async()=>{{ const ex=st.doc.ex; ex.mode='js'; ex.trigger='api';
          const texts=st.doc.layers.filter(l=>l.type==='text'&&!l.hid).map(l=>l.geo); await fo.prepareFonts(texts,'outline');
          ex.player='embed'; const emb=B.buildExport(null).code;
          ex.player='external'; ex.playerSrc='own'; ex.playerUrl={json.dumps(url)}; const ext=B.buildExport(null).code;
          ex.playerSrc='cdn'; const cdn=B.buildExport(null).code; ex.player='embed';
          return {{emb, ext, cdn, id: B.buildExport(null).svgId}} }}""")
        emb,ext,cdn,sid=codes['emb'],codes['ext'],codes['cdn'],codes['id']
        check('external: no player code in the SVG, the JSON and one link instead', 'CinEngine' not in ext and 'data-cin' in ext and f'href="{url}"' in ext)
        check('much smaller than embedded', len(ext) < len(emb)-15000, (len(ext), len(emb)))
        check('jsDelivr address with the player version by default', 'https://cdn.jsdelivr.net/npm/svgcinema-player@' in cdn and '/cin-player.min.js' in cdn)
        check('the JSON is safe in XML (no raw < > &)', all(c not in ext.split('data-cin="1">')[1].split('</script>')[0] for c in '<>&'))
        # standalone SVG files, served from the dev server's origin
        async def serve(route, body, ctype):
            await route.fulfill(status=200, content_type=ctype, body=body)
        await pg.route('**/__t/emb.svg', lambda r: serve(r, emb, 'image/svg+xml'))
        await pg.route('**/__t/ext.svg', lambda r: serve(r, ext, 'image/svg+xml'))
        page_html='<!doctype html><html><body style="margin:0">'+ext.replace(f'id="{sid}"', 'id="a"')+ext.replace(f'id="{sid}"', 'id="b"')+'</body></html>'
        await pg.route('**/__t/two.html', lambda r: serve(r, page_html, 'text/html'))
        async def frame_at(u, ms):
            await pg.goto(base+u); await pg.wait_for_timeout(800)
            return await ev(f"""(()=>{{const s=document.documentElement; if(!s.player) return null; s.player.seekTo({ms});
              return [...s.querySelectorAll('[id]')].slice(0,60).map(e=>(e.getAttribute('transform')||'')+'|'+(e.getAttribute('opacity')||'')).join(';')}})()""")
        a=await frame_at('__t/emb.svg', 1200); c=await frame_at('__t/ext.svg', 1200)
        check('the external player starts the standalone SVG', c is not None)
        check('…and draws the same frame as the embedded player', a is not None and a==c)
        await pg.goto(base+'__t/ext.svg'); await pg.wait_for_timeout(600)
        st0=await ev("(()=>{const p=document.documentElement.player; p.play(); return p.currentTime})()"); await pg.wait_for_timeout(500)
        st1=await ev("document.documentElement.player.currentTime")
        check('the API works (play, currentTime)', st1>st0, (st0,st1))
        check('window.CinPlayer with its version', await ev("typeof CinPlayer==='object' && typeof CinPlayer.version==='string'"))
        await pg.goto(base+'__t/two.html'); await pg.wait_for_timeout(1000)
        both=await ev("['a','b'].map(i=>!!document.getElementById(i).player)")
        check('inline: two SVGs on one page each get their player', both==[True,True], both)
        ready=await ev("""new Promise(res=>{const s=document.getElementById('a'); const x=document.createElementNS('http://www.w3.org/2000/svg','svg'); res(!!CinPlayer.boot)})""")
        check('CinPlayer.boot for SVGs added later', ready)
        # the Export dialog's preview plays an external export with the editor's own player
        await pg.goto(base); await pg.wait_for_timeout(2500)
        await ev("async()=>{ window.st=await import('/src/core/state.ts'); st.doc.ex.mode='js'; st.doc.ex.player='external'; st.doc.ex.playerSrc='cdn'; }")
        await pg.keyboard.press('Control+e'); await pg.wait_for_timeout(2500)
        pv=await ev("(()=>{const s=document.querySelector('#xprev svg');return !!(s&&s.player)})()")
        check('Export preview plays the external export', pv)
        await ev("(async()=>{ const st=await import('/src/core/state.ts'); st.doc.ex.player='embed'; })()")
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
