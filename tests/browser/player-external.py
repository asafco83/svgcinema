import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Player › External: the SVG carries its animation as JSON and a tiny loader. The loader uses the
# page's own player (window.CinPlayer) when there is one, otherwise the first SVG loads the player
# file from jsDelivr (served here from player/cin-player.min.js, built by scripts/build-player.mjs)
# and that one copy starts every SVG. It plays exactly like the embedded player, and the Export
# dialog's Player row, <img> warning, preview and Embed tab follow the choice.
import subprocess
ROOT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..')
async def main():
    subprocess.run(['node','scripts/build-player.mjs'], cwd=ROOT, check=True, capture_output=True)
    PLAYER=open(os.path.join(ROOT,'player/cin-player.min.js')).read()
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
        cdn_hits=[]
        async def cdn(route):
            cdn_hits.append(route.request.url); await route.fulfill(status=200, content_type='text/javascript', body=PLAYER)
        await pg.context.route('https://cdn.jsdelivr.net/**', cdn)
        codes=await ev(f"""async()=>{{ const ex=st.doc.ex; ex.mode='js'; ex.trigger='api';
          const texts=st.doc.layers.filter(l=>l.type==='text'&&!l.hid).map(l=>l.geo); await fo.prepareFonts(texts,'outline');
          ex.player='embed'; const emb=B.buildExport(null).code;
          ex.player='external'; const ext=B.buildExport(null).code; ex.player='embed';
          return {{emb, ext, id: B.buildExport(null).svgId}} }}""")
        emb,ext,sid=codes['emb'],codes['ext'],codes['id']
        loader=ext.split('</script>')[1] if '</script>' in ext else ''
        check('external: no player code in the SVG, the JSON and a tiny loader instead', 'CinEngine' not in ext and 'data-cin' in ext and 'href=' not in ext.split('data-cin')[1] and len(loader)<1024, len(loader))
        check('much smaller than embedded', len(ext) < len(emb)-15000, (len(ext), len(emb)))
        check('the loader names jsDelivr with the player version', 'https://cdn.jsdelivr.net/npm/svgcinema-player@' in ext and '/cin-player.min.js' in ext)
        check('the JSON is safe in XML (no raw < > &)', all(c not in ext.split('data-cin="1">')[1].split('</script>')[0] for c in '<>&'))
        # standalone SVG files, served from the dev server's origin
        async def serve(route, body, ctype):
            await route.fulfill(status=200, content_type=ctype, body=body)
        await pg.route('**/__t/emb.svg', lambda r: serve(r, emb, 'image/svg+xml'))
        await pg.route('**/__t/ext.svg', lambda r: serve(r, ext, 'image/svg+xml'))
        two=ext.replace(f'id="{sid}"', 'id="a"').replace(f"'{sid}'",'"a"').replace(f'"{sid}"','"a"')+ext.replace(f'id="{sid}"', 'id="b"').replace(f'"{sid}"','"b"')
        page_html='<!doctype html><html><body style="margin:0">'+two+'</body></html>'
        own_html='<!doctype html><html><head><script src="/__t/own-player.js"></script></head><body style="margin:0">'+two+'</body></html>'
        await pg.route('**/__t/two.html', lambda r: serve(r, page_html, 'text/html'))
        await pg.route('**/__t/own.html', lambda r: serve(r, own_html, 'text/html'))
        await pg.route('**/__t/own-player.js', lambda r: serve(r, PLAYER, 'text/javascript'))
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
        check('window.CinPlayer with its version and data format', await ev("typeof CinPlayer==='object' && typeof CinPlayer.version==='string' && CinPlayer.f===1"))
        cdn_hits.clear(); await pg.goto(base+'__t/two.html'); await pg.wait_for_timeout(1000)
        both=await ev("['a','b'].map(i=>!!document.getElementById(i).player)")
        check('inline, no player on the page: both SVGs play, the player loaded from jsDelivr once', both==[True,True] and len(cdn_hits)==1, (both, len(cdn_hits)))
        cdn_hits.clear(); await pg.goto(base+'__t/own.html'); await pg.wait_for_timeout(1000)
        both=await ev("['a','b'].map(i=>!!document.getElementById(i).player)")
        check('the page has its own player: both SVGs use it, nothing from jsDelivr', both==[True,True] and not cdn_hits, (both, cdn_hits))
        ready=await ev("""new Promise(res=>{const s=document.getElementById('a'); const x=document.createElementNS('http://www.w3.org/2000/svg','svg'); res(!!CinPlayer.boot)})""")
        check('CinPlayer.boot for SVGs added later', ready)
        # the Export dialog's preview plays an external export with the editor's own player
        await pg.goto(base); await pg.wait_for_timeout(2500)
        await ev("async()=>{ window.st=await import('/src/core/state.ts'); st.doc.ex.mode='js'; st.doc.ex.player='embed'; }")
        await pg.keyboard.press('Control+e'); await pg.wait_for_timeout(2500)
        vis=lambda s: pg.is_visible(s)
        check('JavaScript: the Player row (Embedded on) and the <img> warning show', await vis('#xPlayerRow') and await vis('#xImgWarn')
              and (await pg.text_content('#xPlayer button.on')).strip()=='Embedded (+24 KB)' and 'offline' in await pg.text_content('#xPlayerNote'))
        check('stats: Player inside', 'Player inside' in await pg.text_content('#xStats'))
        await pg.screenshot(path=OUT+'export-player-embed.png')
        cdn_hits.clear()
        await pg.click('#xPlayer [data-v=external]'); await pg.wait_for_timeout(2000)
        check('External: the choice is kept and the note names jsDelivr and the version', await ev("st.doc.ex.player")=='external'
              and 'jsDelivr' in await pg.text_content('#xPlayerNote') and '1.0.0' in await pg.text_content('#xPlayerNote'))
        check('stats: Player external', 'Player external' in await pg.text_content('#xStats'))
        pv=await ev("(()=>{const s=document.querySelector('#xprev svg');return !!(s&&s.player)})()")
        check('the preview plays it with the editor’s player (nothing fetched)', pv and not cdn_hits, cdn_hits)
        await pg.screenshot(path=OUT+'export-player-external.png')
        await pg.click('#xTab [data-v=embed]'); await pg.click('#xFw [data-v=html]'); await pg.wait_for_timeout(200)
        sn=await ev("document.getElementById('xSnip').value")
        check('Embed › HTML: the optional player line first, then the inline SVG', sn.startswith('<!-- Optional: your own copy of the player.') and 'YOUR-ADDRESS/cin-player.min.js' in sn and '<svg id=' in sn and 'cinready' in sn, sn[:120])
        check('…with Download the player (version)', await vis('#xPlayerDl') and (await pg.text_content('#xPlayerDl')).strip()=='Download the player (1.0.0)'
              and (await pg.get_attribute('#xPlayerDl','href')).endswith('downloads/cin-player-1.0.0.min.js'))
        await pg.screenshot(path=OUT+'export-player-embedtab.png')
        await pg.click('#xFw [data-v=react]'); await pg.wait_for_timeout(100)
        check('other frameworks (they use <object>): no download button', await pg.is_hidden('#xPlayerDl'))
        await pg.click('#xTab [data-v=preview]'); await pg.click('#xMode [data-v=css]'); await pg.wait_for_timeout(1500)
        check('CSS only: no Player row, note or warning', await pg.is_hidden('#xPlayerRow') and await pg.is_hidden('#xPlayerNote') and await pg.is_hidden('#xImgWarn')
              and 'Player' not in await pg.text_content('#xStats'))
        await ev("st.doc.ex.mode='js'; st.doc.ex.player='embed'")
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
