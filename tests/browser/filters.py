import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Filters, round 1: the grouped Add filter menu (Glow and Inner glow are named versions of the shadows),
# cards that collapse to one row (with a summary), Collapse all, drag to reorder (every card folds while
# dragging and opens again after), Outline's Position (Gap only outside), and Spread turning the drop
# shadow into its full chain.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page()
        await pg.set_viewport_size({'width':1440,'height':1000}); pg.set_default_timeout(6000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/'), wait_until='domcontentloaded'); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.C=await import('/src/core/constants.ts'); window.bx=await import('/src/export/build.ts'); }")
        ev=lambda js, a=None: pg.evaluate(js, a); R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        lid=await ev("st.doc.layers.find(l=>l.name==='Blob').id"); L=f"st.doc.layers.find(l=>l.id==='{lid}')"
        await ev(f"hi.select('{lid}')"); await pg.wait_for_timeout(300)
        async def addf(p):
            await pg.click('#fx-add'); await pg.click(f'#fxMenu [data-fxp={p}]'); await pg.wait_for_timeout(200)
        # the menu
        await pg.click('#fx-add'); await pg.wait_for_timeout(150)
        menu=await ev("[...document.querySelectorAll('#fxMenu > *')].map(e=>e.classList.contains('ctx-h')?'#'+e.textContent:e.querySelector('span').textContent+(e.querySelector('kbd')?' ('+e.querySelector('kbd').textContent+')':''))")
        check('menu: groups and filters in order', menu==['#Blur & shadow','Blur','Drop shadow','Glow (shadow)','Inner shadow','Inner glow (inner shadow)','#Colour','Brightness','Contrast','Saturation','Hue rotate','Grayscale','Sepia','Invert','Colour overlay','#Edges','Outline'], menu)
        pad=await ev("[getComputedStyle(document.querySelector('#fxMenu button')).paddingLeft, getComputedStyle(document.querySelector('#fxMenu .ctx-h')).paddingLeft]")
        check('menu items are indented under their titles', float(pad[0][:-2])>float(pad[1][:-2]), pad)
        check('menu below the Add button', await ev("document.getElementById('fxMenu').getBoundingClientRect().top>=document.getElementById('fx-add').getBoundingClientRect().bottom"))
        await pg.screenshot(path=OUT+'filters-menu.png')
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(100)
        check('Esc closes the menu', not await ev("!!document.getElementById('fxMenu')"))
        await pg.click('#fx-add'); await pg.mouse.click(600,400); await pg.wait_for_timeout(100)
        check('a click elsewhere closes it', not await ev("!!document.getElementById('fxMenu')"))
        await ev(f"hi.select('{lid}')"); await pg.wait_for_timeout(200)
        # add: Outline, Glow, Brightness, Drop shadow
        for p_ in ['outline','glow','bright','shadow']: await addf(p_)
        names=await ev("[...document.querySelectorAll('.fxc .fxc-name b')].map(b=>b.textContent)")
        check('cards keep the name they were added under', names==['Outline','Glow','Brightness','Drop shadow'], names)
        check('Glow is a drop shadow with spread', await ev(f"{L}.fx[1].type==='shadow' && {L}.b['fx.f2.sp']===2 && {L}.fx[1].name==='Glow'"))
        check('timeline label uses the name', await ev(f"C.propLabel({L},'fx.f2.sd')")=='Glow · Blur')
        # outline position
        check('outline outside shows Gap', await ev("!!document.getElementById('i-fx_f1_g')"))
        await pg.click('[data-act=fxpos][data-fx=f1][data-v=in]'); await pg.wait_for_timeout(200)
        check('outline inside hides Gap', not await ev("!!document.getElementById('i-fx_f1_g')") and await ev(f"{L}.fx[0].pos")=='in')
        fx=await ev(f"document.querySelector('#e-{lid} filter').innerHTML")
        check('inside outline erodes', 'operator="erode"' in fx, fx[:200])
        await pg.click('[data-act=fxpos][data-fx=f1][data-v=out]'); await pg.wait_for_timeout(200)
        # collapse one card: its rows hide, its summary shows
        await pg.click('[data-act=fxtg][data-fx=f3]'); await pg.wait_for_timeout(150)
        st_=await ev("(()=>{const c=document.querySelector('[data-fxc=f3]');return [c.classList.contains('closed'), c.querySelector('.fxc-body').checkVisibility(), c.querySelector('.fxc-sum').checkVisibility(), c.querySelector('.fxc-sum').textContent]})()")
        check('a closed card is one row with a summary', st_[0] and not st_[1] and st_[2] and st_[3].strip()=='120%', st_)
        h=await ev("document.querySelector('[data-fxc=f3]').getBoundingClientRect().height")
        check('one row high', 26<=h<=32, h)
        # a new filter opens; the closed one stays closed
        await addf('overlay')
        check('a new filter opens, others keep their state', await ev("document.querySelector('[data-fxc=f5]').classList.contains('closed')")==False and await ev("document.querySelector('[data-fxc=f3]').classList.contains('closed')"))
        # collapse all / expand all
        await pg.click('.fx-all'); await pg.wait_for_timeout(150)
        check('Collapse all closes every card', await ev("[...document.querySelectorAll('.fxc')].every(c=>c.classList.contains('closed'))") and (await pg.text_content('.fx-all')).strip()=='Expand all')
        await pg.screenshot(path=OUT+'filters-collapsed.png', clip={'x':1440-300,'y':0,'width':300,'height':1000})
        await pg.click('.fx-all'); await pg.wait_for_timeout(150)
        check('Expand all opens them', await ev("![...document.querySelectorAll('.fxc')].some(c=>c.classList.contains('closed'))"))
        check('the heading does not fold when the button is clicked', not await ev("[...document.querySelectorAll('#insp .sec')].find(s=>s.querySelector('h3').childNodes[0].textContent.trim()==='Filters').classList.contains('closed')"))
        await pg.click('[data-act=fxtg][data-fx=f3]'); await pg.wait_for_timeout(150)
        # drag Drop shadow (f4) above Glow (f2): every card folds while dragging, then opens again
        await ev("""(()=>{window.__dt=new DataTransfer(); const h=document.querySelector('[data-fxh=f4]');
          h.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:__dt,clientX:h.getBoundingClientRect().left+40,clientY:h.getBoundingClientRect().top+10}))})()""")
        await pg.wait_for_timeout(120)
        fold=await ev("[document.querySelector('.fxl').classList.contains('folded'), [...document.querySelectorAll('.fxc-body')].every(b=>!b.checkVisibility()), document.querySelector('[data-fxc=f4]').classList.contains('dragging')]")
        check('dragging folds every card to one row', all(fold), fold)
        await pg.screenshot(path=OUT+'filters-drag.png', clip={'x':1440-300,'y':0,'width':300,'height':1000})
        await ev("""(()=>{const c=document.querySelector('[data-fxc=f2]'),r=c.getBoundingClientRect();
          c.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:__dt,clientX:r.left+60,clientY:r.top+4}));
          c.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:__dt,clientX:r.left+60,clientY:r.top+4}));
          document.querySelector('[data-fxh=f4]')?.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:__dt}));
          document.getElementById('insp').dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:__dt}))})()""")
        await pg.wait_for_timeout(250)
        order=await ev(f"{L}.fx.map(f=>f.id).join()")
        check('the drop puts it above the card', order=='f1,f4,f2,f3,f5', order)
        after=await ev("[!document.querySelector('.fxl.folded'), [...document.querySelectorAll('.fxc')].map(c=>c.dataset.fxc+':'+(c.classList.contains('closed')?'closed':'open'))]")
        check('after the drop every card is as it was', after[0] and after[1]==['f1:open','f4:open','f2:open','f3:closed','f5:open'], after)
        check('reorder is one undo step', await ev(f"(hi.undo(), {L}.fx.map(f=>f.id).join())")=='f1,f2,f3,f4,f5')
        await ev("hi.redo()"); await pg.wait_for_timeout(200)
        # spread turns the drop shadow into its chain, which the runtime animates
        await ev(f"hi.select('{lid}')"); await pg.wait_for_timeout(200)
        await pg.fill('#i-fx_f4_sp','3'); await pg.press('#i-fx_f4_sp','Tab'); await pg.wait_for_timeout(200)
        fx=await ev(f"document.querySelector('#e-{lid} filter').innerHTML")
        check('spread uses the full shadow chain', 'id="e-'+lid+'-f4m"' in fx and 'radius="3"' in fx, fx[:160])
        await pg.click('[data-kb="fx.f1.g"]'); await pg.wait_for_timeout(100)
        code=await ev("bx.buildExport(null).code")
        check('export: the outline gap drives both rings', '"fx.f1.g":[["-f1a","radius","add","fx.f1.w"],["-f1b","radius"]]' in code)
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R,indent=1,ensure_ascii=False)); print('FAILS',F)
        await b.close()
asyncio.run(main())
