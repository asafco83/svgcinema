import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The main menu (☰): New project, Open · Edit ▸ Element ▸ Animate ▸ · Save, Save as, Import, Export ·
# View ▸ Help ▸, the submenus following the selection, keyboard use, and Help › About (version,
# copyright, licence).
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(5000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.V=await import('/src/core/view.ts'); }")
        ev=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        lid=lambda n: ev(f"st.doc.layers.find(l=>l.name==='{n}').id")
        top=lambda: ev("[...document.querySelectorAll('#fileMenu > .lm-it > button, #fileMenu > hr')].map(b=>b.tagName==='HR'?'-':b.querySelector('span').textContent)")
        sub=lambda k: ev(f"[...document.querySelectorAll('#fileMenu [data-sub={k}] > .lm-sub > .lm-it > button, #fileMenu [data-sub={k}] > .lm-sub > hr')].map(b=>b.tagName==='HR'?'-':(b.disabled?'(':'')+b.querySelector('span:not(.lm-chk)').textContent+(b.disabled?')':''))")
        await pg.click('#bMenu'); await pg.wait_for_timeout(100)
        check('the main menu, laid out as SVGator\'s', await top()==['New project…','Open…','Open recent','-','Edit','Element','Animate','-','Save','Save as…','Import files…','Export…','-','View','Help'], await top())
        check('with nothing selected Element and Animate grey out', await ev("[...document.querySelectorAll('#fileMenu [data-sub=element] > button, #fileMenu [data-sub=animate] > button')].every(b=>b.disabled)"))
        await pg.hover('#fileMenu [data-sub=element] > button'); await pg.wait_for_timeout(100)
        check('a greyed-out submenu opens no empty box', await ev("getComputedStyle(document.querySelector('#fileMenu [data-sub=element] > .lm-sub')).display")=='none')
        e=await sub('edit')
        check('Edit: undo … select all', e[:2]==['(Undo)','(Redo)'] and 'Select all' in e and '(Paste)' in e, e)
        await pg.keyboard.press('Escape')
        # with a selection
        sun=await lid('Sun'); await ev(f"hi.select('{sun}')")
        await pg.click('#bMenu'); await pg.wait_for_timeout(100)
        el=await sub('element')
        check('Element: the layer commands, without Copy/Paste and Animate (they have their own menus)', 'Group' in el and 'Center origin' in el and 'Hide' in el and 'Lock' in el and 'Copy / Paste' not in el and 'Animate' not in el, el)
        an=await sub('animate')
        check('Animate: the properties with their ⇧ keys', 'Position' in an and await ev("[...document.querySelectorAll('#fileMenu [data-sub=animate] kbd')].some(k=>k.textContent==='⇧ P')"), an)
        vw=await sub('view'); hp=await sub('help')
        check('View: zoom and the view toggles with ticks', 'Zoom to fit' in vw and 'Rulers' in vw and await ev("document.querySelectorAll('#fileMenu [data-sub=view] [role=menuitemcheckbox]').length")>=6, vw)
        check('Help: shortcuts, the sample scene, About', hp[0]=='Keyboard shortcuts' and 'Open the sample scene…' in hp and hp[-1]=='About SVGcinema', hp)
        # hover opens a submenu; a click runs the command
        await pg.hover('#fileMenu [data-sub=element] > button'); await pg.wait_for_timeout(120)
        check('hovering a submenu opens it', await ev("getComputedStyle(document.querySelector('#fileMenu [data-sub=element] > .lm-sub')).display")!='none')
        geo=lambda sel: ev(f"""(()=>{{const s=document.querySelector('{sel}'),r=s.getBoundingClientRect();return {{top:r.top,bottom:r.bottom,left:r.left,right:r.right,scroll:s.scrollHeight>s.clientHeight+1,ov:getComputedStyle(s).overflowY,shown:getComputedStyle(s).display!=='none'}}}})()""")
        g=await geo('#fileMenu [data-sub=element] > .lm-sub')
        check('a submenu that fits has no scrollbar and stays in the window', g['shown'] and not g['scroll'] and g['ov']!='auto' and g['bottom']<=900, g)
        # crossing the gap slowly from the item to its submenu keeps it open
        it=await pg.locator('#fileMenu [data-sub=element] > button').bounding_box(); sb=await geo('#fileMenu [data-sub=element] > .lm-sub')
        y=it['y']+it['height']/2; x0=it['x']+it['width']-6
        stayed=True
        await pg.mouse.move(x0,y)
        for x in range(int(x0), int(sb['left'])+6):
            await pg.mouse.move(x,y)
            if not (await geo('#fileMenu [data-sub=element] > .lm-sub'))['shown']: stayed=False; break
        check('moving slowly across the gap into a submenu keeps it open', stayed, (x0, sb['left']))
        await pg.hover('#fileMenu [data-lm=mp]'); await pg.wait_for_timeout(120)
        g2=await geo('#fileMenu [data-lm=mp] + .lm-sub')
        hit=await ev(f"(()=>{{const e=document.elementFromPoint({(g2['left']+g2['right'])/2},{g2['top']+12});return !!(e&&e.closest('[data-lm=mp] + .lm-sub'))}})()")
        check('a deeper level (Set motion path) opens too, in full', g2['shown'] and hit and g2['right']<=1440, g2)
        await pg.screenshot(path=OUT+'main-menu.png')
        await pg.click('#fileMenu [data-sub=element] [data-lm=hide]'); await pg.wait_for_timeout(100)
        check('Element › Hide hides the layer and closes the menu', await ev(f"st.layerById('{sun}').hid") and await ev("fileMenu.hidden"))
        await pg.click('#bMenu'); await pg.hover('#fileMenu [data-sub=edit] > button'); await pg.click('#fileMenu [data-lm="ed:undo"]'); await pg.wait_for_timeout(100)
        check('Edit › Undo', not await ev(f"st.layerById('{sun}').hid"))
        r0=await ev("V.VIEW.rulers")
        await pg.click('#bMenu'); await pg.hover('#fileMenu [data-sub=view] > button'); await pg.click('#fileMenu [data-lm="vw:rulers"]'); await pg.wait_for_timeout(100)
        check('View › Rulers turns them on or off', await ev("V.VIEW.rulers")==(not r0))
        await pg.click('#bMenu'); await pg.hover('#fileMenu [data-sub=view] > button')
        check('and the tick follows', await ev("document.querySelector('#fileMenu [data-lm=\"vw:rulers\"]').getAttribute('aria-checked')")==str(not r0).lower())
        await pg.click('#fileMenu [data-lm="vw:rulers"]')
        n=await ev(f"st.layerById('{sun}').t.op ? st.layerById('{sun}').t.op.length : 0")
        await pg.click('#bMenu'); await pg.hover('#fileMenu [data-sub=animate] > button'); await pg.click('#fileMenu [data-lm="anim:op"]'); await pg.wait_for_timeout(100)
        check('Animate › Opacity adds a key', await ev(f"(st.layerById('{sun}').t.op||[]).length")==n+1)
        await ev("hi.undo()")
        # a short window: the submenu moves up to fit, and scrolls only if it is taller than the window
        await pg.keyboard.press('Escape'); await ev(f"hi.select('{sun}')")
        await pg.set_viewport_size({'width':1440,'height':560}); await pg.wait_for_timeout(150)
        await pg.click('#bMenu'); await pg.hover('#fileMenu [data-sub=element] > button'); await pg.wait_for_timeout(120)
        g=await geo('#fileMenu [data-sub=element] > .lm-sub')
        check('in a short window it moves up to fit (or scrolls when taller than the window)', g['shown'] and g['bottom']<=560 and g['top']>=0 and (g['scroll']==(g['bottom']-g['top']>=544)), g)
        # a window too short for it: it scrolls, and the next level still flies out beside it, in full
        await pg.keyboard.press('Escape'); await pg.set_viewport_size({'width':860,'height':420}); await pg.wait_for_timeout(150)
        await pg.click('#bMenu'); await pg.hover('#fileMenu [data-sub=element] > button'); await pg.wait_for_timeout(120)
        g=await geo('#fileMenu [data-sub=element] > .lm-sub')
        await pg.hover('#fileMenu [data-lm=mp]'); await pg.wait_for_timeout(150)
        g3=await geo('#fileMenu [data-lm=mp] + .lm-sub')
        hit=await ev(f"(()=>{{const e=document.elementFromPoint({(g3['left']+g3['right'])/2},{g3['top']+12});return !!(e&&e.closest('[data-lm=mp] + .lm-sub'))}})()")
        check('in a very short window the submenu scrolls, and Set motion path still opens beside it, in full', g['scroll'] and g3['shown'] and hit and (g3['left']>=g['right']-4 or g3['right']<=g['left']+4) and g3['bottom']<=420, (g,g3))
        # and with the scrollbar there, crossing slowly from Set motion path into its submenu keeps it open
        it=await pg.locator('#fileMenu [data-lm=mp]').bounding_box(); y=it['y']+it['height']/2
        stayed=True
        for x in range(int(it['x']+it['width']-6), int(g3['left'])+8):
            await pg.mouse.move(x,y)
            if not (await geo('#fileMenu [data-lm=mp] + .lm-sub'))['shown']: stayed=False; break
        check('moving slowly over the scrollbar and the gap into the next level keeps it open', stayed)
        await pg.keyboard.press('Escape'); await pg.set_viewport_size({'width':1440,'height':900}); await pg.wait_for_timeout(100)
        # keyboard
        await pg.click('#bMenu'); await pg.wait_for_timeout(80)
        for k in ['ArrowDown','ArrowDown']: await pg.keyboard.press(k)
        f1=await ev("document.activeElement.textContent")
        await pg.keyboard.press('ArrowRight'); f2=await ev("document.activeElement.textContent")
        await pg.keyboard.press('ArrowLeft'); f3=await ev("document.activeElement.textContent")
        await pg.keyboard.press('Escape')
        check('arrow keys walk the menu and into a submenu (its first item that can run); Esc closes', f1.startswith('Edit') and f2.split('Ctrl')[0] in ('Undo','Redo') and f3.startswith('Edit') and await ev("fileMenu.hidden"), (f1,f2,f3))
        # About
        await pg.click('#bMenu'); await pg.hover('#fileMenu [data-sub=help] > button'); await pg.click('#fileMenu [data-lm="hp:about"]'); await pg.wait_for_timeout(150)
        pkg=json.load(open(os.path.join(os.path.dirname(__file__),'..','..','package.json')))
        check('Help › About shows the version from package.json', not await ev("mAbout.hidden") and await ev("abVersion.textContent")==pkg['version'], await ev("abVersion.textContent"))
        check('the build (commit, date and time)', await ev("!!document.getElementById('abBuild') && /\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}/.test(abBuild.textContent)"), await ev("(document.getElementById('abBuild')||{}).textContent"))
        check('the copyright from LICENSE', (await ev("abCopy.textContent")).startswith('Copyright © 2026 asafco83') and 'All rights reserved' in await ev("abCopy.textContent"), await ev("abCopy.textContent"))
        check('the licence, in short and in full', 'yours to use' in await ev("aboutBody.textContent") and 'proprietary' in await ev("document.querySelector('.ab-lic pre').textContent"))
        check('and the open-source parts', 'Paper.js' in await ev("aboutBody.textContent") and 'opentype.js' in await ev("aboutBody.textContent"))
        await pg.screenshot(path=OUT+'about.png')
        await pg.keyboard.press('Escape')
        check('Esc closes it', await ev("mAbout.hidden"))
        R['errors']=errs; print(json.dumps(R,indent=1,ensure_ascii=False)); print('FAILS',F+(['errors'] if errs else []))
        await b.close()
asyncio.run(main())
