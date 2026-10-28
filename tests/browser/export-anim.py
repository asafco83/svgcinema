import asyncio, sys, json, os, struct, zipfile
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Export › GIF & Animated WebP: the options, the real file's size and the comparison with the original,
# the playhead (frames, part), Play, zoom, the files themselves (GIF blocks, WebP chunks), the embed code
# and the set, and the shared footer.
def gif_info(b):
    """(width, height, frames, loops, delays) from a GIF's blocks."""
    w,h,pk=struct.unpack('<HHB',b[6:11]); o=13
    if pk&0x80: o+=3*(1<<((pk&7)+1))
    frames=0; loops=None; delays=[]
    def sub(o):
        while b[o]: o+=b[o]+1
        return o+1
    while o<len(b):
        c=b[o]
        if c==0x3b: break
        if c==0x21:
            lbl=b[o+1]
            if lbl==0xf9: delays.append(struct.unpack('<H',b[o+4:o+6])[0]); o+=8; continue
            if lbl==0xff and b[o+3:o+14]==b'NETSCAPE2.0': loops=struct.unpack('<H',b[o+16:o+18])[0]
            o=sub(o+2); continue
        if c==0x2c:
            frames+=1; ip=b[o+9]; o+=10
            if ip&0x80: o+=3*(1<<((ip&7)+1))
            o=sub(o+1); continue
        raise ValueError('bad block %x at %d'%(c,o))
    return w,h,frames,loops,delays
def webp_chunks(b):
    out=[]; o=12
    while o+8<=len(b):
        cid=b[o:o+4].decode('latin1'); n=struct.unpack('<I',b[o+4:o+8])[0]; out.append(cid); o+=8+n+(n&1)
    return out
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(accept_downloads=True); pg=await ctx.new_page()
        await pg.set_viewport_size({'width':1440,'height':900}); pg.set_default_timeout(20000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        base=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/'
        await pg.goto(base, wait_until='domcontentloaded'); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); }")
        ev=lambda js, a=None: pg.evaluate(js, a); R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        async def made():
            # the banner shows a real size once the file is made
            await pg.wait_for_function("()=>document.getElementById('xaUpd').textContent.startsWith('Updates') && /KB|MB/.test(document.getElementById('xaSize').textContent)", timeout=60000)
        await ev("localStorage.removeItem('svgcinema:exportKind'); delete st.doc.ex.anim; hi.setTime(1.2)")
        await pg.click('#bExport'); await pg.wait_for_timeout(600)
        check('the picker offers GIF & Animated WebP', await ev("!document.querySelector('#xKind [data-v=\"anim\"]').hidden"))
        await pg.click('#xKind [data-v="anim"]')
        vis=await ev("['xOptsAnim','xaPrev'].map(i=>!document.getElementById(i).hidden).concat([document.getElementById('xCopy').hidden, document.getElementById('xOptsVid').hidden, document.getElementById('xSvgPrev').hidden])")
        check('GIF shows its options and comparison; no second footer button', vis==[True]*5, vis)
        z=await ev("[...document.querySelectorAll('#xPrevZoom button')].filter(b=>!b.hidden).map(b=>b.textContent)")
        check('zoom: Fit, 100%, 200%', z==['Fit','100%','200%'], z)
        await made()
        a=await ev("st.doc.ex.anim")
        check('defaults: GIF, 15 fps, 75%, 128 colours, diffusion, lossy 60, only changes', [a['fmt'],a['fps'],a['scale'],a['colours'],a['dither'],a['lossy'],a['changed']]==['gif',15,'75',128,'diff',60,True], a)
        dims=await ev("[document.getElementById('xaW').value, document.getElementById('xaH').value]")
        check('75% of the 640 × 400 document', dims==['480','300'], dims)
        foot=await ev("[document.getElementById('xFileSize').textContent, document.getElementById('xFileSub').textContent, document.getElementById('xDlT').textContent, document.getElementById('xaSize').textContent]")
        check('footer: the real size, GIF · 480 × 300 · frames · 15 fps, Download .gif', foot[0]==foot[3] and foot[1].startswith('GIF · 480 × 300 · ') and foot[1].endswith('· 15 fps') and foot[2]=='Download .gif', foot)
        await pg.wait_for_function("document.getElementById('xaSaving').textContent!==''", timeout=60000)
        sv=await ev("document.getElementById('xaSaving').textContent")
        check('the saving against a plain GIF of the same frames', 'smaller than a plain GIF' in sv, sv)
        cmp=await ev("(()=>{const o=document.getElementById('xaOrig'),c=document.getElementById('xaComp');return [o.width,o.height,c.width,c.height,o.style.width===c.style.width]})()")
        check('the original and the GIF frame side by side, same size', cmp==[480,300,480,300,True], cmp)
        lbl=await ev("document.getElementById('xaCompLbl').textContent")
        check('the compressed side says what it is', lbl=='GIF · 128 colours · dithered', lbl)
        # the divider
        await ev("(()=>{const s=document.getElementById('xaSplit');s.value=30;s.dispatchEvent(new Event('input'))})()")
        check('the divider moves', await ev("document.getElementById('xaBox').style.getPropertyValue('--split')")=='30%')
        # controls that apply only sometimes are hidden
        await pg.click('#xaDither [data-v="none"]'); await pg.wait_for_timeout(100)
        check('no dithering: no Strength', await ev("document.getElementById('xaStrRow').hidden"))
        await pg.click('#xaDither [data-v="noise"]'); await pg.wait_for_timeout(100)
        check('Noise dithering: Strength shows', await ev("!document.getElementById('xaStrRow').hidden"))
        await pg.click('#xaChanged'); await pg.wait_for_timeout(100)
        check('not storing changes: no Tolerance', await ev("document.getElementById('xaTolRow').hidden"))
        await pg.click('#xaChanged')
        await pg.click('#xaAlpha'); await pg.wait_for_timeout(100)
        check('transparent: Edge colour and its note show', await ev("!document.getElementById('xaMatteRow').hidden && !document.getElementById('xaMatteNote').hidden"))
        await pg.click('#xaAlpha')
        keep=await ev("[...document.querySelectorAll('#xaKeep .xkeep')].map(b=>b.dataset.c)")
        check('Keep exact offers the document’s colours', len(keep)>=3, keep)
        await pg.click('#xaKeep .xkeep >> nth=0'); await pg.wait_for_timeout(100)
        check('…and remembers the picked ones', await ev("st.doc.ex.anim.keep.length")==1)
        # colours slider: a real 2–256 range
        await ev("(()=>{const s=document.getElementById('xaCol');s.value=37;s.dispatchEvent(new Event('input'));s.dispatchEvent(new Event('change'))})()")
        await made()
        check('colours: any number from 2 to 256', await ev("st.doc.ex.anim.colours")==37 and await ev("document.getElementById('xaColv').textContent")=='37')
        # frames: part, rate, ticks
        await pg.click('#xaPart [data-v="part"]'); await pg.fill('#xaFrom','0.5'); await pg.press('#xaFrom','Enter'); await pg.fill('#xaTo','2.5'); await pg.press('#xaTo','Enter')
        await pg.select_option('#xaFps','10'); await made()
        tk=await ev("[document.querySelectorAll('#xaTicks span').length, document.querySelectorAll('#xaTicks span.in').length, document.getElementById('xaSpan').style.width]")
        check('the track: a tick per frame, those in the part marked, the band', tk[0]==31 and tk[1]==21 and tk[2].startswith('66.6'), tk)
        sub=await ev("document.getElementById('xFileSub').textContent")
        check('2 s at 10 fps: 20 frames or fewer (merged)', '· 10 fps' in sub and int(sub.split(' · ')[2].split(' ')[0])<=20, sub)
        # the playhead shows the frame there, from the file already made
        box=await pg.locator('#xaScrub').bounding_box()
        await pg.mouse.click(box['x']+box['width']*0.5, box['y']+box['height']/2); await pg.wait_for_timeout(600)
        check('dragging the playhead moves the editor’s playhead', abs(await ev("st.S.time")-1.5)<0.08, await ev("st.S.time"))
        # zoom
        await pg.click('#xPrevZoom [data-v="200"]'); await pg.wait_for_timeout(100)
        zw=await ev("document.getElementById('xaComp').style.width")
        check('200%: twice the pixels, crisp', zw=='960px' and await ev("getComputedStyle(document.getElementById('xaComp')).imageRendering")=='pixelated', zw)
        await pg.click('#xPrevZoom [data-v="fit"]')
        # Play the file itself
        await pg.click('#xaPlay'); await pg.wait_for_timeout(300)
        pl=await ev("[document.getElementById('xaBox').classList.contains('playing'), !document.getElementById('xaPlayImg').hidden, document.getElementById('xaPlayImg').naturalWidth]")
        check('Play shows the GIF itself, playing', pl==[True,True,480], pl)
        await pg.click('#xaPlay'); await pg.wait_for_timeout(100)
        check('…and Stop goes back to the comparison', not await ev("document.getElementById('xaBox').classList.contains('playing')"))
        await pg.screenshot(path=OUT+'export-anim.png')
        # download the GIF
        await pg.select_option('#xaLoops','3'); await made()
        async with pg.expect_download(timeout=60000) as d: await pg.click('#xDl')
        dl=await d.value; path=OUT+'export-anim.gif'; await dl.save_as(path); data=open(path,'rb').read()
        check('the GIF is saved under the project name', dl.suggested_filename.endswith('.gif'), dl.suggested_filename)
        w,h,n,loops,delays=gif_info(data)
        check('GIF89a, 480 × 300, plays 3 times', data[:6]==b'GIF89a' and (w,h)==(480,300) and loops==2, (data[:6],w,h,loops))
        try:
            from PIL import Image
            im=Image.open(path); pf=im.n_frames; im.seek(pf-1); im.convert('RGB')
            check('Pillow reads every frame of the GIF', pf==n, (pf,n))
        except ImportError: pass
        check('frames at 10 fps (10 hundredths each, merged ones longer)', 0<n<=20 and all(x%10==0 for x in delays) and sum(delays)==200, (n,delays[:6],sum(delays)))
        check('the download is the size shown', abs(len(data)-await ev("(t=>parseFloat(t)*(t.includes('MB')?1048576:1024))(document.querySelector('#xaSize').textContent)"))<=max(1024,len(data)*0.05), len(data))
        # Animated WebP
        await pg.click('#xaFmt [data-v="webp"]'); await made()
        check('Animated WebP: its own compression section', await ev("document.getElementById('xaSecGif').hidden && !document.getElementById('xaSecWebp').hidden && document.getElementById('xDlT').textContent==='Download .webp'"))
        sv=await ev("document.getElementById('xaSaving').textContent")
        check('…and what a plain GIF would weigh', sv.startswith('a plain GIF would be'), sv)
        await pg.click('#xaWll'); await pg.wait_for_timeout(100)
        check('Lossless hides Quality', await ev("document.getElementById('xaWqRow').hidden"))
        await pg.click('#xaWll'); await made()
        async with pg.expect_download(timeout=60000) as d: await pg.click('#xDl')
        wb=open(await (await d.value).path(),'rb').read()
        ch=webp_chunks(wb)
        check('WebP: RIFF, VP8X, ANIM, ANMF frames', wb[:4]==b'RIFF' and wb[8:12]==b'WEBP' and ch[:2]==['VP8X','ANIM'] and ch.count('ANMF')>=2 and set(ch[2:])=={'ANMF'}, ch[:5])
        try:
            from PIL import Image
            import io
            im=Image.open(io.BytesIO(wb)); wf=im.n_frames; im.seek(wf-1); im.convert('RGBA')
            check('Pillow reads every frame of the Animated WebP', wf==ch.count('ANMF') and im.size==(480,300), (wf,im.size))
        except ImportError: pass
        img=await ev("""(b)=>new Promise(res=>{const i=new Image();i.onload=()=>res([i.naturalWidth,i.naturalHeight]);i.onerror=()=>res('error');i.src=URL.createObjectURL(new Blob([new Uint8Array(b)],{type:'image/webp'}))})""", list(wb))
        check('the browser opens the Animated WebP', img==[480,300], img)
        # embed and the set
        await pg.click('#xTab [data-v="embed"]'); await pg.wait_for_timeout(150)
        sn=await ev("document.getElementById('xaSnip').value")
        check('Embed: <picture> with the WebP and a GIF behind it', '<picture>' in sn and 'type="image/webp"' in sn and '.gif"' in sn and 'width="480"' in sn, sn)
        check('GIF fallback on, with a size', await ev("document.getElementById('xaFb').checked && document.getElementById('xaFbKb').textContent.startsWith('≈ ') && document.getElementById('xaSetT').textContent==='Download the set (.zip)'"))
        async with pg.expect_download(timeout=90000) as d: await pg.click('#xaSet')
        zp=await (await d.value).path(); names=sorted(zipfile.ZipFile(zp).namelist())
        check('the set: the WebP and its GIF', len(names)==2 and names[0].endswith('.gif') and names[1].endswith('.webp'), names)
        g=zipfile.ZipFile(zp).read(names[0])
        check('…the GIF is a real GIF', g[:6]==b'GIF89a' and gif_info(g)[2]>0)
        check('the other kinds’ embed is hidden', await ev("document.getElementById('xSvgEmbed').hidden && document.getElementById('xvEmbed').hidden && !document.getElementById('xaEmbed').hidden"))
        await pg.click('#xTab [data-v="preview"]')
        # back to another kind: the zoom is theirs again
        await pg.click('#xKind [data-v="svg"]'); await pg.wait_for_timeout(400)
        z=await ev("[...document.querySelectorAll('#xPrevZoom button')].filter(b=>!b.hidden).map(b=>b.textContent)")
        check('Animated SVG gets Fit / Actual size back, and Copy', z==['Fit','Actual size'] and await ev("!document.getElementById('xCopy').hidden && document.getElementById('xaPrev').hidden"), z)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        check('settings are kept with the project', await ev("st.doc.ex.anim.fmt==='webp' && st.doc.ex.anim.fps===10 && st.doc.ex.anim.loops===3"))
        await ev("localStorage.removeItem('svgcinema:exportKind')")
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
