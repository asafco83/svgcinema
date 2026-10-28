import asyncio, sys, json
from playwright.async_api import async_playwright
import os
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(device_scale_factor=1); await pg.set_viewport_size({'width':1440,'height':1000})
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts');}")
        ev=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        await ev("st.S.pps=60; (async()=>{(await import('/src/ui/timeline.ts')).renderTimeline()})()"); await pg.wait_for_timeout(100)
        lw=await ev("document.getElementById('ruler').getBoundingClientRect().right"); sw=await ev("document.getElementById('tlscroll').getBoundingClientRect().right")
        check('ruler fills the panel', lw>=sw-30, (lw,sw))
        labels=await ev("[...document.querySelectorAll('#ruler .tk b')].map(b=>b.textContent)")
        check('ticks beyond the length', '6s' in labels or len(labels)>4, labels[-3:])
        check('shaded after the end', await ev("!!document.querySelector('#ruler .tl-out')"))
        e=await ev("(()=>{const r=document.getElementById('tlEnd').getBoundingClientRect();return [r.x+r.width/2,r.y+20]})()")
        await pg.mouse.move(*e); await pg.mouse.down()
        await pg.mouse.move(e[0]+60*2.5, e[1], steps=8)
        tip=await ev("(()=>{const t=document.getElementById('tlEndTip');return t&&!t.hidden?t.textContent:null})()")
        dur=await ev("st.doc.dur"); box=await ev("document.getElementById('tDur').value")
        check('dragging updates length live, box and tip', abs(dur-5.5)<0.06 and box=='0:05.50' and tip and '0:05.50' in tip, (dur,box,tip))
        await pg.mouse.up(); await pg.wait_for_timeout(100)
        check('tip hides after drag', await ev("document.getElementById('tlEndTip').hidden"))
        await pg.keyboard.press('Control+z')
        check('one undo step', await ev("st.doc.dur")==3, await ev("st.doc.dur"))
        await pg.fill('#tDur','4'); await pg.press('#tDur','Tab'); await pg.wait_for_timeout(100)
        x=await ev("document.getElementById('tlEnd').getBoundingClientRect().x+5.5 - document.getElementById('ruler').getBoundingClientRect().x")
        check('typing length moves the end line', abs(x-240)<2, x)
        await pg.screenshot(path=OUT+'tlr.png', clip={'x':0,'y':740,'width':1440,'height':260})
        R['errors']=errs; print(json.dumps(R,indent=1)); print('FAILS',F); await b.close()
asyncio.run(main())
