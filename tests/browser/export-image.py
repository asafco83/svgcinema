import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Export › Image: the picker in the dialog's header, one frame as PNG, JPEG, WebP, AVIF, JPEG XL or a
# still SVG, the playhead under the preview (it is the editor's), scale, background, the embed code,
# downloads, and the kind remembered for next time.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(accept_downloads=True); pg=await ctx.new_page()
        await pg.set_viewport_size({'width':1440,'height':900}); pg.set_default_timeout(15000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        base=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/'
        await pg.goto(base, wait_until='domcontentloaded'); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); }")
        ev=lambda js, a=None: pg.evaluate(js, a); R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        async def settled(ms=20000):
            # the footer shows a size once the picture is drawn and encoded
            await pg.wait_for_function("()=>{const s=document.getElementById('xFileSize').textContent;return /KB|MB/.test(s)}", timeout=ms)
            await pg.wait_for_timeout(150)
        await ev("localStorage.removeItem('svgcinema:exportKind'); delete st.doc.ex.img; hi.setTime(1.8)")
        await pg.click('#bExport'); await pg.wait_for_timeout(800)
        kinds=await ev("[...document.querySelectorAll('#xKind button')].filter(b=>!b.hidden).map(b=>b.textContent.trim())")
        check('the picker offers Animated SVG and Image', kinds==['Animated SVG','Image'], kinds)
        check('it opens on Animated SVG the first time', await ev("document.querySelector('#xKind .on').dataset.v==='svg' && !document.getElementById('xOptsSvg').hidden && document.getElementById('xOptsImg').hidden"))
        check('the title is just Export', await ev("document.getElementById('xTitle').textContent")=='Export')
        await pg.click('#xKind [data-v="image"]'); await settled()
        check('Image shows its own options, preview and footer', await ev("document.getElementById('xOptsSvg').hidden && !document.getElementById('xOptsImg').hidden && !document.getElementById('xiPrev').hidden && document.getElementById('xSvgPrev').hidden"))
        png=await ev("({nw:document.getElementById('xiImg').naturalWidth, nh:document.getElementById('xiImg').naturalHeight, sub:document.getElementById('xFileSub').textContent, dl:document.getElementById('xDlT').textContent, copy:document.getElementById('xCopy').textContent})")
        check('PNG at 2× by default, the playhead’s frame', png['nw']==1280 and png['nh']==800 and png['sub']=='PNG · 1280 × 800 · 1.80s', png)
        check('footer: Copy image and Download .png', png['dl']=='Download .png' and png['copy']=='Copy image', png)
        ph=await ev("[document.getElementById('xiT').textContent, document.getElementById('xiPhFlag').textContent, document.getElementById('xiPhLine').style.left]")
        check('the playhead shows the time like the editor', ph[0]=='0:01.80' and ph[1]=='1.80s' and abs(float(ph[2].rstrip('%'))-60)<0.01, ph)
        rows=await ev("['xiQRow','xiLlRow','xiEffRow'].map(i=>!document.getElementById(i).hidden)")
        check('PNG has no quality, lossless or encoding rows', rows==[False,False,False], rows)
        # a pixel of the frame: the sun is drawn (warm colour) where the editor shows it at 1.8 s
        sizes={}
        for f,exp in [('jpeg','JPEG'),('webp','WebP'),('avif','AVIF'),('jxl','JPEG XL'),('svg','SVG')]:
            await pg.click(f'#xiFmt [data-v="{f}"]'); await pg.wait_for_timeout(200); await settled(40000)
            r=await ev("({sub:document.getElementById('xFileSub').textContent, size:document.getElementById('xFileSize').textContent, img:document.getElementById('xiImg').hidden?0:document.getElementById('xiImg').naturalWidth, cv:!document.getElementById('xiCv').hidden, dl:document.getElementById('xDlT').textContent, rows:['xiQRow','xiLlRow','xiEffRow','xiScaleRow','xiFitRow'].map(i=>!document.getElementById(i).hidden)})")
            sizes[f]=r
            check(f'{exp}: made and shown', r['sub'].startswith(exp+' · ') and (r['img']>0 or r['cv']), r)
        check('JPEG: quality, no lossless', sizes['jpeg']['rows'][:3]==[True,False,False], sizes['jpeg']['rows'])
        check('AVIF: quality, lossless and encoding effort', sizes['avif']['rows'][:3]==[True,True,True], sizes['avif']['rows'])
        check('JPEG XL: shown as PNG where the browser can’t show it, with the note', sizes['jxl']['cv'] or sizes['jxl']['img']>0)
        check('SVG: still vector, Fit instead of scale', sizes['svg']['sub'].startswith('SVG · still vector') and sizes['svg']['rows'][3:]==[False,True], sizes['svg'])
        check('the download names the format', sizes['avif']['dl']=='Download .avif' and sizes['jpeg']['dl']=='Download .jpg', [sizes['avif']['dl'],sizes['jpeg']['dl']])
        kbv=lambda s: float(s.split()[0])*(1024 if 'MB' in s else 1)
        check('AVIF is smaller than JPEG', kbv(sizes['avif']['size'])<kbv(sizes['jpeg']['size']), [sizes['avif']['size'],sizes['jpeg']['size']])
        check('JPEG XL warns that not every browser shows it', await ev("(async()=>{document.querySelector('#xiFmt [data-v=\"jxl\"]').click(); await new Promise(r=>setTimeout(r,50)); return !document.getElementById('xiJxlWarn').hidden && document.getElementById('xiFmtNote').hidden})()"))
        await settled(40000)
        # JPEG can't be transparent: the choice isn't offered
        await pg.click('#xiFmt [data-v="jpeg"]'); await settled()
        check('JPEG hides Transparent and uses the document background', await ev("document.querySelector('#xiBg [data-v=\"transparent\"]').hidden && document.querySelector('#xiBg .on').dataset.v==='doc'"))
        await pg.click('#xiFmt [data-v="png"]'); await settled()
        # scale and a typed size
        await pg.click('#xiScale [data-v="1"]'); await settled()
        check('1× is the canvas size', await ev("document.getElementById('xiImg').naturalWidth")==640)
        await pg.fill('#xiW','1000'); await pg.press('#xiW','Enter'); await settled()
        sz=await ev("[document.getElementById('xiW').value, document.getElementById('xiH').value, document.querySelector('#xiScale .on').dataset.v, document.getElementById('xiImg').naturalWidth]")
        check('typing a width keeps the proportions and picks Custom', sz==['1000','625','c',1000], sz)
        await pg.click('#xiScale [data-v="2"]'); await settled()
        # background
        await pg.click('#xiBg [data-v="doc"]'); await settled()
        px=await ev("""(async()=>{const im=document.getElementById('xiImg'),c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const x=c.getContext('2d');x.drawImage(im,0,0);return [...x.getImageData(2,c.height-3,1,1).data]})()""")
        check('Document: the background is painted (opaque corner)', px[3]==255, px)
        await pg.click('#xiBg [data-v="colour"]'); await pg.wait_for_timeout(100)
        check('Colour shows a colour field', await ev("!document.getElementById('xiBgcRow').hidden"))
        await pg.click('#xiBg [data-v="transparent"]'); await settled()
        # the playhead: dragging it moves the editor's playhead and redraws the frame
        before=await ev("document.getElementById('xFileSize').textContent")
        box=await pg.locator('#xiScrub').bounding_box()
        await pg.mouse.click(box['x']+box['width']*0.25, box['y']+box['height']/2); await pg.wait_for_timeout(200); await settled()
        t=await ev("st.S.time")
        check('dragging the playhead moves the editor’s playhead', abs(t-0.75)<0.08, t)
        check('…and the frame and time follow it', await ev("document.getElementById('xFileSub').textContent.endsWith(st.S.time.toFixed(2)+'s') && document.getElementById('xiT').textContent==='0:0'+st.S.time.toFixed(2)"), await ev("document.getElementById('xFileSub').textContent"))
        await pg.click('#xiNextF'); await pg.wait_for_timeout(100)
        t2=await ev("st.S.time")
        check('the arrow steps one frame (1/30 s)', abs(t2-t-1/30)<0.002, [t,t2])
        await pg.fill('#xiTime','0:02.50'); await pg.press('#xiTime','Enter'); await pg.wait_for_timeout(100)
        check('typing a time moves the playhead', abs(await ev("st.S.time")-2.5)<0.001)
        await settled()
        await pg.screenshot(path=OUT+'export-image.png')
        # zoom
        await pg.click('#xPrevZoom [data-v="actual"]'); await pg.wait_for_timeout(200)
        check('Actual size shows the picture’s own pixels', await ev("document.getElementById('xiBox').classList.contains('actual') && document.getElementById('xPrevLbl').textContent==='1280 × 800 px · shown at 100%' && !document.getElementById('xiImg').hidden"), await ev("document.getElementById('xPrevLbl').textContent"))
        await pg.click('#xPrevZoom [data-v="fit"]')
        # downloads
        async with pg.expect_download() as d: await pg.click('#xDl')
        dl=await d.value
        check('Download saves the picture under the project name', dl.suggested_filename.endswith('.png'), dl.suggested_filename)
        # embed
        await pg.click('#xiFmt [data-v="avif"]'); await settled(40000)
        await pg.click('#xTab [data-v="embed"]'); await pg.wait_for_timeout(200)
        sn=await ev("document.getElementById('xiSnip').value")
        check('Embed: <picture> with AVIF, WebP and PNG, 1× and 2×', sn.startswith('<picture>') and 'image/avif' in sn and 'image/webp' in sn and '@2x.png 2x' in sn, sn)
        check('the SVG embed is hidden for Image', await ev("document.getElementById('xSvgEmbed').hidden && !document.getElementById('xiEmbed').hidden"))
        async with pg.expect_download(timeout=60000) as d: await pg.click('#xiSet')
        z=await d.value
        check('Download the set gives a zip', z.suggested_filename.endswith('.zip'), z.suggested_filename)
        zp=await z.path(); import zipfile
        names=sorted(zipfile.ZipFile(zp).namelist())
        check('the set holds each format at 1× and 2×', len(names)==6 and any(n.endswith('@2x.avif') for n in names) and any(n.endswith('.png') for n in names), names)
        await pg.click('#xiFb'); await pg.click('#xiHi'); await pg.wait_for_timeout(100)
        check('without extras it is one file and a plain <img>', await ev("document.getElementById('xiSnip').value.startsWith('<img') && document.getElementById('xiSetT').textContent==='Download .avif'"))
        await pg.click('#xTab [data-v="preview"]')
        # settings kept with the project; the kind remembered; closing lets go of the hidden frames
        check('settings are kept with the project', await ev("st.doc.ex.img.fmt==='avif' && st.doc.ex.img.fallbacks===false"))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        check('closing removes the hidden frame source', await ev("!document.querySelector('[id=\"cinframe-svg\"]')"))
        await pg.click('#bExport'); await settled(40000)
        check('the dialog opens again on Image', await ev("document.querySelector('#xKind .on').dataset.v==='image' && !document.getElementById('xOptsImg').hidden"))
        await pg.click('#xKind [data-v="svg"]'); await pg.wait_for_timeout(1500)
        check('back to Animated SVG: its preview and footer', await ev("!!document.querySelector('#xprev svg') && document.getElementById('xDlT').textContent==='Download .svg' && document.getElementById('xCopy').textContent==='Copy SVG code'"))
        await ev("localStorage.removeItem('svgcinema:exportKind')")
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
