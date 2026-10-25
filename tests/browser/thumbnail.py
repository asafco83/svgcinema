import asyncio, sys, json, os, base64
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Every project file carries thumbnail.png (the first frame): first in the zip, uncompressed, 512 px on
# its long side, so file managers' thumbnail handlers can read it straight from the file.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(8000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        # as on Windows (the download window leads with the download for the system you're on)
        await pg.add_init_script("Object.defineProperty(Navigator.prototype,'platform',{get:()=>'Win32'})")
        await pg.goto(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/'); await pg.wait_for_timeout(2500)
        await pg.evaluate("""async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts');
          window.zp=await import('/src/io/zip.ts'); window.th=await import('/src/io/thumbnail.ts'); }""")
        ev=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        await ev("hi.setTime(1.5)")  # the thumbnail is the first frame whatever the playhead shows
        info=await ev("""async()=>{
          const blob=await zp.buildProject(true), buf=await blob.arrayBuffer(), u8=new Uint8Array(buf), dv=new DataView(buf);
          const nl=dv.getUint16(26,true), name=new TextDecoder().decode(u8.subarray(30,30+nl)), method=dv.getUint16(8,true);
          const z=await zp.readZip(buf), png=await z.get('thumbnail.png');
          const bm=await createImageBitmap(new Blob([png],{type:'image/png'}));
          const c=document.createElement('canvas'); c.width=bm.width; c.height=bm.height; const x=c.getContext('2d'); x.drawImage(bm,0,0);
          const d=x.getImageData(0,0,c.width,c.height).data; const cols=new Set();
          for(let i=0;i<d.length;i+=4*97) cols.add((d[i]>>4)+','+(d[i+1]>>4)+','+(d[i+2]>>4));
          const corner=[d[0],d[1],d[2]];
          let b64=''; for(let i=0;i<png.length;i+=0x8000) b64+=String.fromCharCode.apply(null,png.subarray(i,i+0x8000));
          return {name, method, w:bm.width, h:bm.height, colours:cols.size, corner, bytes:png.length, names:z.names.slice(0,4), b64:btoa(b64), time: st.S.time};
        }""")
        open(OUT+'thumbnail.png','wb').write(base64.b64decode(info.pop('b64')))
        check('thumbnail.png is the first entry of the project file', info['name']=='thumbnail.png', info['names'])
        check('…stored uncompressed', info['method']==0)
        check('512 px on the long side, canvas proportions', info['w']==512 and info['h']==round(512*400/640), (info['w'],info['h']))
        check('a real picture (not blank)', info['colours']>20, info['colours'])
        check("the scene's dark night sky", sum(info['corner'])<120 and info['corner'][2]>info['corner'][0], info['corner'])
        check('small', info['bytes']<250000, info['bytes'])
        check('the editor stays where it was', info['time']==1.5)
        # opening a project with a thumbnail works as before
        n0=await ev("st.doc.layers.length")
        ok=await ev("""async()=>{ const o=await import('/src/io/open.ts'); const blob=await zp.buildProject(true);
          await o.loadProjectFile(new File([blob],'Thumb test.SVGcinema')); return st.doc.layers.length; }""")
        check('a project with a thumbnail opens', ok==n0, (ok,n0))
        # Help › Thumbnails on your computer…: the download window
        await pg.click('#bMenu'); await pg.hover('#fileMenu [data-sub=help] > button'); await pg.wait_for_timeout(200)
        items=await ev("[...document.querySelectorAll('#fileMenu [data-sub=help] [data-lm]')].map(b=>b.dataset.lm)")
        check('Help menu: Thumbnails on your computer…, right under Spell check', 'hp:thumbs' in items and items.index('hp:thumbs')==items.index('hp:spell')+1, items)
        await pg.click('#fileMenu [data-lm="hp:thumbs"]'); await pg.wait_for_timeout(200)
        d=await ev("""(()=>{const m=document.getElementById('mThumbs');const a=[...m.querySelectorAll('a')].map(x=>x.href);
          return {open:!m.hidden, title:m.querySelector('h2').textContent, first:a[0], links:a.length, warn:!!m.querySelector('.th-warn'), files:m.querySelectorAll('.th-file').length}})()""")
        check('it opens the download window', d['open'] and d['title']=='Thumbnails on your computer', d)
        check('Windows installer first, with the warning', d['first'].endswith('SVGcinema-Thumbnails-Setup.exe') and d['warn'], d['first'])
        check('Linux downloads and All downloads on the small line', d['links']==4 and d['files']==3)
        await pg.locator('#mThumbs .dlg').screenshot(path=OUT+'thumbs-dialog.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)
        check('Esc closes it', await ev("document.getElementById('mThumbs').hidden"))
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
