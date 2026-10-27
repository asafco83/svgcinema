import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Stroke alignment (Appearance › Align): the three buttons, how the stroke is drawn (pixels just inside
# and outside the edge), a see-through fill showing no stroke under it, an animated size the copy follows
# (editor, JS and CSS exports), Undo, and the row hidden on an open path.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(5000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        url=(sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')
        await pg.goto(url); await pg.wait_for_timeout(2500)
        await pg.evaluate("""async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts');
          window.tl=await import('/src/agent/tools.ts'); window.bd=await import('/src/export/build.ts'); }""")
        E=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        # a 100 × 100 square with a 20 px stroke on an empty canvas, see-through fill
        box=await E("""(async()=>{ st.doc.layers.forEach(l=>l.hid=true); st.doc.bg='#ffffff';
          const r=await tl.runTool('add_shape',{kind:'rect',name:'Square',x:200,y:100,w:100,h:100,fill:'#0000ff',stroke:'#ff0000',strokeWidth:20});
          st.layerById(r.result.id).b.fo=0.3;
          hi.select(r.result.id); return r.result.id })()""")
        await pg.wait_for_timeout(300)
        btns=await E("[...document.querySelectorAll('[data-tx=al]')].map(b=>[b.dataset.v, b.getAttribute('aria-pressed'), b.title])")
        check('Appearance has Align: centre (on), inside, outside', [x[0] for x in btns]==['center','in','out'] and btns[0][1]=='true', btns)
        check('…its icons are the owner’s (small band, knocked centre, large band)', await E("[...document.querySelectorAll('[data-tx=al] svg path')].length")==4)
        # what is drawn d px (document units) from the square's left edge, at mid height: read from a screenshot
        import io
        from PIL import Image
        async def px(d):
            q=await E(f"""(()=>{{const s=document.getElementById('e-{box}-s'), m=s.getScreenCTM(), x=+s.getAttribute('x'), y=+s.getAttribute('y')+(+s.getAttribute('height'))/2;
              const p=new DOMPoint(x+{d},y).matrixTransform(m); return [p.x,p.y]}})()""")
            await E("document.querySelector('#overlay').style.display='none'")
            shot=Image.open(io.BytesIO(await pg.screenshot())).convert('RGB')
            await E("document.querySelector('#overlay').style.display=''")
            return list(shot.getpixel((int(round(q[0])),int(round(q[1])))))
        red=lambda c: c[0]>200 and c[1]<80 and c[2]<80
        # the edge is x = 200; the stroke is 20 wide
        c_out, c_in = await px(-7), await px(7)
        check('centre: the stroke straddles the edge', red(c_out) and red(c_in), [c_out,c_in])
        await pg.click('[data-tx=al][data-v=in]'); await pg.wait_for_timeout(250)
        c_out, c_in, c_deep = await px(-5), await px(5), await px(17)
        check('inside: the stroke lies inside the edge, 20 px deep', not red(c_out) and red(c_in) and red(c_deep), [c_out,c_in,c_deep])
        check('…and the Inspector still says 20 px', await E("document.querySelector('#i-sw').value")=='20')
        await pg.click('[data-tx=al][data-v=out]'); await pg.wait_for_timeout(250)
        c_out, c_far, c_in = await px(-5), await px(-17), await px(5)
        check('outside: the stroke lies outside the edge', red(c_out) and red(c_far) and not red(c_in), [c_out,c_far,c_in])
        check('…a see-through fill shows no stroke under it', c_in[2]>c_in[0], c_in)
        check('the setting is kept on the layer', await E(f"st.layerById('{box}').al")=='out')
        await E("hi.undo()"); await pg.wait_for_timeout(200)
        check('Undo goes back to inside', await E(f"st.layerById('{box}').al")=='in' and await E("document.querySelector('[data-tx=al][data-v=in]').getAttribute('aria-pressed')")=='true')
        await pg.click('[data-tx=al][data-v=out]'); await pg.wait_for_timeout(200)
        # an animated size: the copy that clips / masks follows the shape
        await E(f"tl.runTool('set_keyframes',{{id:'{box}',prop:'sz',keys:[{{t:0,v:[100,100]}},{{t:1,v:[160,100]}}]}})"); await pg.wait_for_timeout(100)
        await E("hi.setTime(1)"); await pg.wait_for_timeout(200)
        w=await E(f"[document.getElementById('e-{box}-s').getAttribute('width'), document.getElementById('e-{box}-sf').getAttribute('width')]")
        check('animated size: the copy follows in the editor', w==['160','160'], w)
        await E("hi.setTime(0)")
        for mode in ['js','css']:
            code=await E(f"(()=>{{st.doc.ex.mode='{mode}'; return bd.buildExport(null).code}})()")
            sp=await b.new_page(viewport={'width':700,'height':450})
            await sp.set_content(code); await sp.wait_for_timeout(1700)
            ww=await sp.evaluate("(()=>{const t=document.querySelector('[id$=\"-sf\"]'), s=document.getElementById(t.id.replace(/-sf$/,'-s')); return [Math.round(t.getBBox().width), Math.round(s.getBBox().width)]})()")
            check(f'{mode.upper()} export: the copy follows the shape as it grows', ww[0]==ww[1] and ww[0]>100, ww)
            await sp.close()
        # an open path: no Align row
        await E("(async()=>{const r=await tl.runTool('add_shape',{kind:'line',name:'Line',x1:10,y1:10,x2:90,y2:10}); hi.select(r.result.id)})()"); await pg.wait_for_timeout(250)
        check('an open path has no Align row (it can only be centred)', not await E("!!document.querySelector('[data-tx=al]')"))
        await pg.screenshot(path=OUT+'stroke-align.png')
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
