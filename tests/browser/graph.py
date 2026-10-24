import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The graph editor: the Graph toggle, one number track opened into a graph (X and Y for points), keys
# dragged for value and time, a segment's handles making a custom easing, the easing set, colour rows.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(5000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ localStorage.removeItem('svgcinema:graph'); window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); }")
        ev=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        title=await ev("st.doc.layers.find(l=>l.name==='Title').id")
        await ev(f"hi.select('{title}'); hi.setTime(1.2)"); await pg.wait_for_timeout(150)
        check('off by default: no graph', await ev("!document.querySelector('.tl-graph')"))
        await pg.click('#tGraph'); await pg.wait_for_timeout(200)
        row=await ev("(()=>{const r=document.querySelector('.tl-graph');return r&&{prop:r.dataset.prop,h:r.getBoundingClientRect().height,curves:r.querySelectorAll('.gr-curve').length,keys:r.querySelectorAll('.gr-key').length}})()")
        check('Graph opens the first number track: Position, X and Y', row and row['prop']=='pos' and row['curves']==2 and row['keys']==4 and row['h']>200, row)
        check('the Graph button is on', await ev("document.getElementById('tGraph').getAttribute('aria-pressed')")=='true')
        await pg.click(".tl-prop[data-prop=op] .tl-pname"); await pg.wait_for_timeout(150)
        check('clicking another track’s name graphs that one (one curve)', await ev("document.querySelector('.tl-graph').dataset.prop")=='op' and await ev("document.querySelectorAll('.tl-graph .gr-curve').length")==1)
        # drag the last opacity key down: its value drops
        await ev("document.getElementById('tlscroll').scrollTop=document.querySelector('.tl-graph').offsetTop-28"); await pg.wait_for_timeout(100)
        k=pg.locator('.tl-graph .gr-key[data-gi="1"]'); bb=await k.bounding_box()
        v0=await ev(f"st.layerById('{title}').t.op[1][1]"); t0=await ev(f"st.layerById('{title}').t.op[1][0]")
        await pg.mouse.move(bb['x']+bb['width']/2, bb['y']+bb['height']/2); await pg.mouse.down()
        await pg.mouse.move(bb['x']+bb['width']/2+28, bb['y']+bb['height']/2+60, steps=6)
        check('dragging shows the time and value', await ev("document.getElementById('grRead') && document.getElementById('grRead').getAttribute('visibility')")=='visible')
        await pg.mouse.up(); await pg.wait_for_timeout(150)
        q=await ev(f"st.layerById('{title}').t.op[1]")
        check('dragging a key changes its value and time', q[1]<v0-0.1 and q[0]>t0+0.05, (q[0],q[1]))
        await ev("hi.undo()"); await pg.wait_for_timeout(100)
        check('one undo step', await ev(f"st.layerById('{title}').t.op[1][1]")==v0)
        # a handle: custom easing
        hd=pg.locator('.tl-graph .gr-hd[data-gh="1"]').first; hb=await hd.bounding_box()
        await pg.mouse.move(hb['x']+4, hb['y']+4); await pg.mouse.down(); await pg.mouse.move(hb['x']+30, hb['y']-20, steps=5); await pg.mouse.up(); await pg.wait_for_timeout(150)
        e=await ev(f"st.layerById('{title}').t.op[0][2]")
        check('dragging a handle makes a custom cubic-bezier', isinstance(e,list) and len(e)==4, e)
        kb=await pg.locator('.tl-graph .gr-key[data-gi="0"]').bounding_box(); await pg.mouse.click(kb['x']+kb['width']/2, kb['y']+kb['height']/2); await pg.wait_for_timeout(150)
        check('the easing presets stay in the Keyframe panel: clicking a key shows them there', await ev("!document.querySelector('.tl-graph .gr-ezb')") and await ev("!!document.getElementById('ezGrid')"))
        v1=await ev("document.querySelector('.tl-graph [data-gv]').textContent"); await ev("hi.setTime(1.5)"); await pg.wait_for_timeout(100)
        v2=await ev("document.querySelector('.tl-graph [data-gv]').textContent")
        check('the value beside the graph follows the playhead', v1!=v2, (v1,v2))
        await pg.screenshot(path=OUT+'graph.png')
        # a colour track has no graph
        blob=await ev("st.doc.layers.find(l=>l.name==='Blob').id")
        await ev(f"hi.select('{blob}')"); await pg.wait_for_timeout(150)
        await pg.click(f".tl-prop[data-lid='{blob}'][data-prop=fill] .tl-pname"); await pg.wait_for_timeout(150)
        check('a colour track says the graph is for numbers', 'number properties only' in await ev("document.getElementById('toast').textContent") and await ev(f"!!document.querySelector(\".tl-prop.no-graph[data-lid='{blob}'][data-prop=fill]\")"))
        await pg.click('#tGraph'); await pg.wait_for_timeout(100)
        check('Graph off: rows are back to normal', await ev("!document.querySelector('.tl-graph')"))
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
