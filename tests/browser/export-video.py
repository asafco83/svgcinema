import asyncio, sys, json, os, struct, zipfile
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Export › Video: MP4 (H.264), WebM (VP9 / AV1) and PNG frames, made by the browser's encoder and our own
# muxers. Checks the options, the preview (frame shape, playhead, Play), progress and Cancel, the
# files themselves (boxes, EBML, zip of frames), the embed code and the shared footer.
def boxes(b, start=0, end=None):
    end=len(b) if end is None else end; out=[]; o=start
    while o+8<=end:
        size,typ=struct.unpack('>I4s',b[o:o+8]); out.append((typ.decode('latin1'),o,size))
        if size<8: break
        o+=size
    return out
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(accept_downloads=True); pg=await ctx.new_page()
        await pg.set_viewport_size({'width':1440,'height':900}); pg.set_default_timeout(15000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        base=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/'
        await pg.goto(base, wait_until='domcontentloaded'); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.vid=await import('/src/export/video.ts'); }")
        ev=lambda js, a=None: pg.evaluate(js, a); R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        await ev("localStorage.removeItem('svgcinema:exportKind'); delete st.doc.ex.vid; hi.setTime(1.2)")
        await pg.click('#bExport'); await pg.wait_for_timeout(600)
        check('the picker offers Video', await ev("!document.querySelector('#xKind [data-v=\"video\"]').hidden"))
        await pg.click('#xKind [data-v="video"]'); await pg.wait_for_timeout(2500)
        can=await ev("vid.CAN")
        check('the browser can encode H.264 here (headless Chromium)', can['h264'], can)
        vis=await ev("['xOptsVid','xvPrev'].map(i=>!document.getElementById(i).hidden).concat([document.getElementById('xCopy').hidden, document.getElementById('xOptsImg').hidden])")
        check('Video shows its options and preview; no second footer button', vis==[True,True,True,True], vis)
        foot=await ev("[document.getElementById('xFileSize').textContent, document.getElementById('xFileSub').textContent, document.getElementById('xDlT').textContent]")
        check('footer: an estimate and Export .mp4', foot[0].startswith('≈ ') and foot[1].startswith('estimate · MP4 · H.264') and foot[2]=='Export .mp4', foot)
        check('the preview mounts the animation', await ev("!!document.querySelector('#xvArt svg')"))
        lbl=await ev("document.getElementById('xPrevLbl').textContent")
        check('1080p: the 16:10 animation is fitted with bars', lbl.startswith('1920 × 1080 · fitted, with bars'), lbl)
        fr=await ev("(()=>{const f=document.getElementById('xvFrame').getBoundingClientRect(),a=document.getElementById('xvArt').getBoundingClientRect();return [Math.round(f.width/f.height*100)/100, a.height>=f.height-1 && a.width<f.width-2]})()")
        check('the frame has the video’s shape, the art sits inside', fr==[1.78,True], fr)
        check('MP4 hides Transparent (can’t be) and says so', await ev("document.getElementById('xvAlphaRow').hidden && !document.getElementById('xvAlphaNote').hidden"))
        # presets and fit
        await pg.select_option('#xvPreset','story'); await pg.wait_for_timeout(200)
        st=await ev("[document.getElementById('xvW').value, document.getElementById('xvH').value, !document.getElementById('xvFitRow').hidden]")
        check('Story 9:16 is 1080 × 1920, with Fit / Fill', st==['1080','1920',True], st)
        await pg.click('#xvFit [data-v="fill"]'); await pg.wait_for_timeout(150)
        check('Fill crops', 'filled, edges cropped' in await ev("document.getElementById('xPrevLbl').textContent"))
        await pg.select_option('#xvPreset','doc'); await pg.wait_for_timeout(150)
        check('Document size: same shape, no Fit row', await ev("document.getElementById('xvFitRow').hidden && document.getElementById('xvW').value==='640'"))
        # timing
        await pg.click('#xvPart [data-v="part"]'); await pg.fill('#xvFrom','0.5'); await pg.press('#xvFrom','Enter'); await pg.fill('#xvTo','1.5'); await pg.press('#xvTo','Enter')
        await pg.select_option('#xvFps','24'); await pg.wait_for_timeout(150)
        tm=await ev("[st.doc.ex.vid.from, st.doc.ex.vid.to, st.doc.ex.vid.fps, document.getElementById('xvRange').textContent, document.getElementById('xvStats').textContent]")
        check('Part of it: from – to, frame rate, and the track shows the span', tm[:3]==[0.5,1.5,24] and tm[3]=='Part: 0:00.50 – 0:01.50' and 'Frames 24' in tm[4], tm)
        # compression rows
        for aim,row in [('size','xvSizeRow'),('rate','xvRateRow'),('q','xvQRow')]:
            await pg.click(f'#xvAim [data-v="{aim}"]'); await pg.wait_for_timeout(80)
            check(f'Aim for {aim} shows its row', await ev(f"!document.getElementById('{row}').hidden"))
        check('quality shows a number', await ev("document.getElementById('xvQv').textContent")=='70')
        # the playhead and Play
        box=await pg.locator('#xvScrub').bounding_box()
        await pg.mouse.click(box['x']+box['width']*0.5, box['y']+box['height']/2); await pg.wait_for_timeout(150)
        check('dragging the playhead moves the editor’s playhead', abs(await ev("st.S.time")-1.5)<0.08, await ev("st.S.time"))
        await ev("hi.setTime(0.5)")
        await pg.click('#xvPlay'); await pg.wait_for_timeout(500)
        t1=await ev("st.S.time")
        check('Play plays the part', 0.6<t1<=1.5 and await ev("document.getElementById('xvPlay').classList.contains('on')"), t1)
        await pg.wait_for_timeout(900)
        check('…and stops at its end', abs(await ev("st.S.time")-1.5)<0.01 and not await ev("document.getElementById('xvPlay').classList.contains('on')"), await ev("st.S.time"))
        # export an MP4 of the part: progress shows while it works
        await pg.select_option('#xvPreset','720'); await pg.wait_for_timeout(100)
        seen={'prog':False,'locked':False}
        async with pg.expect_download(timeout=120000) as d:
            await pg.click('#xDl')
            for _ in range(40):
                s=await ev("[!document.getElementById('xProg').hidden, document.getElementById('xOptsVid').classList.contains('locked')]")
                if s[0]: seen['prog']=True
                if s[1]: seen['locked']=True
                if seen['prog']: break
                await pg.wait_for_timeout(50)
        dl=await d.value; path=OUT+'export-video.mp4'; await dl.save_as(path)
        check('while it works: progress in the footer, options locked', seen['prog'] and seen['locked'], seen)
        check('the MP4 is saved under the project name', dl.suggested_filename.endswith('.mp4'), dl.suggested_filename)
        data=open(path,'rb').read(); top=boxes(data)
        check('MP4: ftyp, moov, mdat (fast start)', [x[0] for x in top]==['ftyp','moov','mdat'], [x[0] for x in top])
        moov=data[top[1][1]:top[1][1]+top[1][2]]
        i=moov.find(b'stsz'); n=struct.unpack('>I',moov[i+12:i+16])[0]
        check('MP4: 24 frames (1 s at 24 fps)', n==24, n)
        i=moov.find(b'tkhd'); w,h=struct.unpack('>II',moov[i+4+76:i+4+84])
        check('MP4: 1280 × 720', (w>>16,h>>16)==(1280,720), (w>>16,h>>16))
        check('MP4: H.264 decoder configuration', b'avcC' in moov)
        check('after saving, the footer shows the real size', await ev("document.getElementById('xFileSub').textContent.endsWith('· saved') && !document.getElementById('xFileSize').textContent.startsWith('≈')"), await ev("document.getElementById('xFileSub').textContent"))
        check('the progress is gone, options unlocked', await ev("document.getElementById('xProg').hidden && !document.getElementById('xOptsVid').classList.contains('locked') && !document.getElementById('xDl').hidden"))
        # WebM, cancelled half way
        if can['vp9']:
            await pg.click('#xvFmt [data-v="webm"]'); await pg.click('#xvPart [data-v="whole"]'); await pg.select_option('#xvFps','60'); await pg.select_option('#xvPreset','1080'); await pg.wait_for_timeout(100)
            check('WebM: codec choice VP9 / AV1', await ev("!document.getElementById('xvCodecWebm').hidden && document.getElementById('xDlT').textContent==='Export .webm'"))
            got=[]
            pg.on('download', lambda d: got.append(d))
            await pg.click('#xDl')
            await pg.wait_for_function("!document.getElementById('xProg').hidden")
            await pg.wait_for_timeout(300)
            await pg.click('#xCancel')
            await pg.wait_for_function("document.getElementById('xProg').hidden", timeout=30000)
            await pg.wait_for_timeout(500)
            check('Cancel stops it: no file', not got, len(got))
            await pg.select_option('#xvFps','30'); await pg.click('#xvPart [data-v="part"]'); await pg.select_option('#xvPreset','doc'); await pg.wait_for_timeout(100)
            async with pg.expect_download(timeout=120000) as d: await pg.click('#xDl')
            wb=await (await d.value).path(); data=open(wb,'rb').read()
            check('WebM: EBML header, webm, V_VP9, duration, cues', data[:4]==b'\x1a\x45\xdf\xa3' and b'webm' in data[:64] and b'V_VP9' in data and b'\x1c\x53\xbb\x6b' in data, len(data))
        # PNG frames
        await pg.click('#xvFmt [data-v="seq"]'); await pg.select_option('#xvFps','24'); await pg.wait_for_timeout(100)
        check('PNG frames: no compression section, files section, Transparent offered', await ev("document.getElementById('xvSecComp').hidden && !document.getElementById('xvSecFiles').hidden && !document.getElementById('xvAlphaRow').hidden"))
        await pg.click('#xvAlpha')
        async with pg.expect_download(timeout=120000) as d: await pg.click('#xDl')
        z=await d.value; zp=await z.path(); names=sorted(zipfile.ZipFile(zp).namelist())
        check('PNG frames: a zip of numbered frames', len(names)==24 and names[0].endswith('_0001.png'), [len(names), names[:2]])
        png=zipfile.ZipFile(zp).read(names[0])
        check('…with transparency (RGBA)', png[25]==6, png[25])
        await pg.click('#xvAlpha'); await pg.click('#xvFmt [data-v="mp4"]')
        # embed
        await pg.click('#xTab [data-v="embed"]'); await pg.wait_for_timeout(150)
        sn=await ev("document.getElementById('xvSnip').value")
        check('Embed: a muted looping <video> with WebM, MP4 and a poster', '<video autoplay muted loop playsinline' in sn and 'video/webm' in sn and 'video/mp4' in sn and 'poster=' in sn, sn)
        check('the other kinds’ embed is hidden', await ev("document.getElementById('xSvgEmbed').hidden && document.getElementById('xiEmbed').hidden && !document.getElementById('xvEmbed').hidden"))
        await pg.click('#xTab [data-v="preview"]')
        await pg.screenshot(path=OUT+'export-video.png')
        # back to the other kinds
        await pg.click('#xKind [data-v="image"]'); await pg.wait_for_timeout(400)
        check('Image brings back Copy image', await ev("!document.getElementById('xCopy').hidden && document.getElementById('xvPrev').hidden"))
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        check('settings are kept with the project', await ev("st.doc.ex.vid.fmt==='mp4' && st.doc.ex.vid.fps===24"))
        await ev("localStorage.removeItem('svgcinema:exportKind')")
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
