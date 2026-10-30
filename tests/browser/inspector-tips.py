import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The Properties panel's explanations as tooltips (the "Properties panel" boards on the Keyline UI
# refresh canvas): an ⓘ at the end of a section title, a sub-heading or a row label holds the text that
# used to be a paragraph; the imported element's note is a warning; titles stay the heading's first text.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':2400}); pg.set_default_timeout(6000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.add_init_script("localStorage.removeItem('svgcinema:inspClosed')")
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("""async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.IN=await import('/src/ui/inspector.ts');
          window.FL=await import('/src/model/filters.ts'); window.SH=await import('/src/tools/shapes.ts'); window.K=await import('/src/core/constants.ts'); }""")
        E=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        ALL="(()=>{const a=[];const w=ls=>ls.forEach(l=>{a.push(l); if(l.kids) w(l.kids)});w(st.doc.layers);return a})()"
        async def pick(name, prep=''):
            await E(f"(()=>{{const l={ALL}.find(x=>x.name==={json.dumps(name)}); {prep}; hi.select(l.id); IN.renderInspector();}})()"); await pg.wait_for_timeout(80)
        tip=lambda title: E(f"(()=>{{const h=[...document.querySelectorAll('#insp .sec > h3')].find(h=>h.childNodes[0].textContent.trim()==={json.dumps(title)}); const t=h&&h.querySelector('.itip'); return t?t.title:null}})()")
        paras=lambda: E("[...document.querySelectorAll('#insp .sec > p')].map(p=>p.textContent)")
        PREP="const c=K.H.comp(l,0); l.pins=[{n:1,x:c.x-10,y:c.y},{n:2,x:c.x+10,y:c.y}]; const p=l.b.pos||[0,0]; l.t.pos=[[0,[p[0],p[1]],'linear'],[1,[p[0]+40,p[1]],'linear']]"

        await pick('Hill color', PREP)
        check('Pins: the help is the title’s tooltip', (await tip('Pins') or '').startswith('Pins bend the path through its own nodes'))
        check('Motion path: the help is the title’s tooltip', (await tip('Motion path') or '').startswith('Drag the path on the canvas'))
        check('Morph: both explanations in one tooltip', 'Add a Morph keyframe' in (await tip('Morph') or '') and 'turns this rectangle into a plain path' in (await tip('Morph') or ''))
        check('Trim path: the help is the sub-heading’s tooltip', await E("[...document.querySelectorAll('#insp .sub')].some(s=>s.textContent.trim()==='Trim path' && (s.querySelector('.itip')||{}).title?.startsWith('Trim shows only part'))"))
        ps=await paras()
        check('…and none of those paragraphs are left', not any(t.startswith(x) for t in ps for x in ['Pins bend','Drag the path','Add a Morph','Editing the nodes','Trim shows']), ps)
        check('titles are still the heading’s first text', await E("[...document.querySelectorAll('#insp .sec > h3')].map(h=>h.childNodes[0].textContent.trim()).includes('Pins')"))
        check('the ⓘ can be focused and says what it is about', await E("(()=>{const t=document.querySelector('#insp .sec > h3 .itip'); return t.tabIndex===0 && /^About /.test(t.getAttribute('aria-label'))})()"))
        open0=await E("!document.querySelector('#insp .itip').closest('.sec').classList.contains('closed')")
        await pg.click('#insp .sec > h3 .itip'); await pg.wait_for_timeout(100)
        check('clicking the ⓘ doesn’t collapse the section', open0 and await E("!document.querySelector('#insp .itip').closest('.sec').classList.contains('closed')"))
        await pg.screenshot(path=OUT+'inspector-tips.png', clip={'x':1144,'y':52,'width':296,'height':1400})
        await pick('Star')
        check('star: its note is the title’s tooltip', (await tip('Star') or '').startswith('Editing the nodes by hand'))
        await pick('Stem 3')
        check('child bone: Inherit scale has its tooltip after the label', await E("(()=>{const t=document.getElementById('fl-inh').closest('label').querySelector('.itip'); return !!t && t.title.startsWith('Off: this bone follows') && !document.getElementById('fl-inh').closest('label').querySelector('.bsub')})()"))
        check('bone: Scale’s W / H note is its label’s tooltip', await E("[...document.querySelectorAll('#insp .rl')].some(r=>r.textContent.trim()==='Scale' && (r.querySelector('.itip')||{}).title==='W along the bone · H across it') && !document.querySelector('.bnote')"))
        await pick('Pole')
        check('Line: the help is the title’s tooltip', (await tip('Line') or '').startswith('Key each end with ◆'))
        await pick('Signature')
        check('mask group: Mask by has its tooltip on the label', await E("(()=>{const r=[...document.querySelectorAll('#insp .rl')].find(r=>r.textContent.trim()==='Mask by'); const t=r&&r.querySelector('.itip'); return !!t && t.title.startsWith('Opacity: the mask shows')})()"))
        check('…the label still fits (the ⓘ is visible, not cut off)', await E("(()=>{const r=[...document.querySelectorAll('#insp .rl')].find(r=>r.textContent.trim()==='Mask by'); const t=r.querySelector('.itip').getBoundingClientRect(), s=r.nextElementSibling.getBoundingClientRect(); return t.width>=14 && t.right<=s.left+1})()"))
        check('group: the keyframes note is the title’s tooltip', (await tip('Group') or '').startswith('Keyframes on a group'))
        await pick('Sparkle 2')
        check('instance: the shared note is the title’s tooltip', 'shared by all' in (await tip('Instance') or ''))
        check('…Time offset has its tooltip, clear of the field', await E("(()=>{const r=document.querySelector('#sym-off').closest('.row'); const t=r.querySelector('.rl .itip'); return !!t && t.title.startsWith('Starts the symbol’s animation later') && t.getBoundingClientRect().right<=r.querySelector('.rf').getBoundingClientRect().left+1})()"))
        check('…and no notes are left in the section', await E("!document.querySelector('#symSec .sym-note')"))
        await pick('Stem')
        check('bone: the long help is the title’s tooltip', (await tip('Bone') or '').startswith('Drag a bone to rotate it'))
        check('…Key whole rig and Own draw order have theirs after the label', await E("['fl-kr','fl-dord'].every(id=>{const t=document.getElementById(id).closest('label').querySelector('.itip'); return !!t && t.title.length>20})"))
        check('…no sub-lines under them', await E("!document.querySelector('#fl-kr').closest('label').querySelector('.bsub') && !document.querySelector('#fl-dord').closest('label').querySelector('.bsub')"))
        # an imported element: a warning, naming what was kept
        await E("""(()=>{const l=st.mkLayer('raw','fo',{markup:'<foreignObject x=\"0\" y=\"0\" width=\"80\" height=\"40\"><div xmlns=\"http://www.w3.org/1999/xhtml\">hi</div></foreignObject>'},{}); SH.addLayer(l); IN.renderInspector();})()"""); await pg.wait_for_timeout(80)
        check('imported element: a warning box, like the Filters one', await E("(()=>{const w=document.querySelector('#insp .raw-warn.xwarn'); return !!w && /Kept as imported: not editable\\./.test(w.textContent) && /a foreignObject/.test(w.textContent)})()"))
        check('…with the same indent as other warnings', await E("(()=>{const w=document.querySelector('#insp .raw-warn'); return getComputedStyle(w).marginLeft==='0px'})()"))
        # several layers: the selection box note is the title's tooltip; "Fields show…" sits under the title
        await E(f"(()=>{{const a={ALL}; hi.select(a.find(l=>l.name==='Sun').id); hi.select(a.find(l=>l.name==='Blob').id,'toggle'); IN.renderInspector();}})()"); await pg.wait_for_timeout(80)
        check('several layers: the box note is the title’s tooltip', (await tip('2 layers selected') or '').startswith('The box around the whole selection'))
        check('…and “Fields show…” comes right under the title', await E("(()=>{const h=[...document.querySelectorAll('#insp .sec > h3')].find(h=>h.childNodes[0].textContent.trim()==='2 layers selected'); const p=h.nextElementSibling; return p.tagName==='P' && p.textContent.startsWith('Fields show')})()"))
        # the align bar: flip and quarter turns after the booleans, with a hairline between them
        await pick('Sun')
        xf=await E("[...document.querySelectorAll('.align-bar [data-xf]')].map(b=>b.dataset.xf+':'+b.disabled)")
        check('the bar has Flip H, Flip V, Rotate 90° right and left after the booleans', xf==['fliph:false','flipv:false','rotr:false','rotl:false'], xf)
        check('…on the same 8-column grid, in the booleans’ row', await E("(()=>{const b=document.querySelector('.align-bar [data-bool=exclude]').getBoundingClientRect(), f=document.querySelector('.align-bar [data-xf=fliph]').getBoundingClientRect(), a=document.querySelectorAll('.align-bar [data-align]')[4].getBoundingClientRect(); return Math.abs(b.top-f.top)<1 && Math.abs(f.left-a.left)<1})()"))
        check('…with a hairline before Flip horizontal', await E("getComputedStyle(document.querySelector('.align-bar [data-xf=fliph]'),'::before').width")=='1px')
        await E(f"window.__sun={ALL}.find(l=>l.name==='Sun'); window.__r0=__sun.b.rot||0; window.__s0=(__sun.b.scl||[1,1])[0]")
        await pg.click('.align-bar [data-xf=rotr]'); await pg.click('.align-bar [data-xf=fliph]'); await pg.wait_for_timeout(80)
        check('Rotate 90° right and Flip horizontal work', await E("(__sun.b.rot||0)===__r0+90 && (__sun.b.scl||[1,1])[0]===-__s0"))
        # Hyperlink: under Rig, at the bottom
        t=await E("[...document.querySelectorAll('#insp .sec > h3')].map(h=>h.childNodes[0].textContent.trim())")
        check('Hyperlink is the last section', t[-1]=='Hyperlink', t)
        check('…with only Link until there is a link', await E("!!document.getElementById('lk-url') && !document.getElementById('lk-target')"))
        await pg.fill('#lk-url','example.com/a'); await pg.press('#lk-url','Enter'); await pg.wait_for_timeout(80)
        check('a link is set (https added) and Opens appears', await E(f"JSON.stringify({ALL}.find(l=>l.name==='Sun').link)")=='{"url":"https://example.com/a","target":"_blank"}' and await E("!!document.getElementById('lk-target')"))
        await pg.select_option('#lk-target','_self'); await pg.wait_for_timeout(80)
        check('Opens: Same tab', await E(f"{ALL}.find(l=>l.name==='Sun').link.target")=='_self')
        await pg.fill('#lk-url','javascript:alert(1)'); await pg.press('#lk-url','Enter'); await pg.wait_for_timeout(80)
        check('a script link is refused (the old link stays)', await E(f"{ALL}.find(l=>l.name==='Sun').link.url")=='https://example.com/a' and 'mailto' in await E("document.querySelector('#toast').textContent"))
        await pg.fill('#lk-url',''); await pg.press('#lk-url','Enter'); await pg.wait_for_timeout(80)
        check('clearing the field removes the link', await E(f"!{ALL}.find(l=>l.name==='Sun').link") and await E("!document.getElementById('lk-target')"))
        await pick('Stem')
        check('no Hyperlink on bones', await E("!document.getElementById('linkSec')"))
        check('the top bar says Export (other formats to come)', (await E("document.getElementById('bExport').textContent.trim()"))=='Export')
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R,indent=1,ensure_ascii=False)); print('FAILS',F)
        await b.close()
asyncio.run(main())
