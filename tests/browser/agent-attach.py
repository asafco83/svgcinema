import asyncio, sys, json, os, base64, tempfile
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Files attached to an agent message: the paperclip, paste and drop; chips (× removes, and the asset
# leaves Assets when nothing uses it); the note for a model that can't see; "@" references (the list,
# keys, coloured, deleted whole, red when the file isn't attached, back to coloured when it is again);
# what the model receives (asset ids in the text, the pictures for a model that can see, not sent
# again later); the sent message's thumbnails; place_image with an attached asset.
# No real provider: Playwright answers OpenRouter's URL with scripted streams.
CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, OPTIONS'}
def oai(text=None, tools=None):
    s=''
    if text: s+='data: '+json.dumps({'choices':[{'index':0,'delta':{'content':text}}]})+'\n\n'
    for n,(name,args) in enumerate(tools or []):
        s+='data: '+json.dumps({'choices':[{'index':0,'delta':{'tool_calls':[{'index':n,'id':f'c{n}','function':{'name':name,'arguments':json.dumps(args)}}]}}]})+'\n\n'
    s+='data: '+json.dumps({'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if tools else 'stop'}]})+'\n\n'
    return s+'data: [DONE]\n\n'
# a 2×2 PNG and a small SVG with 3 parts
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==')
SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#fff"/><path d="M8 28L20 10l12 18z" fill="none" stroke="#161a25"/><circle cx="20" cy="22" r="4" fill="#3b5bfd"/></svg>'
async def main():
    tmp=tempfile.mkdtemp()
    def f(name,data):
        p=os.path.join(tmp,name); open(p,'wb').write(data if isinstance(data,bytes) else data.encode()); return p
    rocket=f('rocket.png',PNG); logo=f('logo.svg',SVG); txt=f('notes.txt','hello')
    extra=[f(f'pic{i}.png',PNG) for i in range(4)]
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(8000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        bodies=[]
        async def route(r):
            q=r.request
            if q.method=='OPTIONS': return await r.fulfill(status=204,headers=CORS)
            if q.method=='GET': return await r.fulfill(status=404,headers=CORS,body='')
            body=json.loads(q.post_data); msgs=body['messages']; bodies.append(body)
            last=[i for i,m in enumerate(msgs) if m['role']=='user'][-1]
            tools=[m for m in msgs[last:] if m['role']=='tool']
            u=msgs[last]['content']; text=u if isinstance(u,str) else ' '.join(x.get('text','') for x in u if x['type']=='text')
            import re
            ids=re.findall(r'@rocket\.png: asset (\S+),',text)
            if ids and not tools: out=oai('Placing it.',[('place_image',{'asset':ids[0],'name':'Rocket'})])
            else: out=oai('Done.')
            await r.fulfill(status=200,headers={**CORS,'content-type':'text/event-stream'},body=out)
        await pg.route('https://openrouter.ai/**', route)
        await pg.add_init_script("""localStorage.setItem('svgcinema:agent.keys',JSON.stringify({openrouter:'test-key'}));
          localStorage.setItem('svgcinema:agent.settings',JSON.stringify({provider:'openrouter',model:'anthropic/claude-sonnet-5.5',connect:'key'}));
          localStorage.setItem('svgcinema:agent.open','1')""")
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("""async()=>{ window.st=await import('/src/core/state.ts'); window.ch=await import('/src/agent/chat.ts');
          window.se=await import('/src/agent/settings.ts'); window.AP=await import('/src/ui/agent-panel.ts'); }""")
        E=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        nAssets="Object.keys(st.ASSETS).length"
        a0=await E(nAssets)

        check('the composer has a paperclip, first in the row (left of the Scene chip)', await E("""(()=>{const c=document.querySelector('#agClip'), s=document.querySelector('#agScope');
          return !!c && c.getAttribute('aria-label')==='Attach files' && c.parentElement.firstElementChild===c && c.getBoundingClientRect().right<=s.getBoundingClientRect().left})()"""))
        check('…and no chips while nothing is attached', await E("document.querySelector('#agAtt').hidden"))
        await pg.set_input_files('#agAttFile',[rocket,logo]); await pg.wait_for_timeout(500)
        chips=await E("[...document.querySelectorAll('.ag-att-i')].map(c=>c.querySelector('b').textContent+'|'+c.querySelector('small').textContent)")
        check('the paperclip attaches files: a chip each, with name and size (vector · parts for SVG)', chips==['rocket.png|2 × 2','logo.svg|vector · 3 parts'], chips)
        check('…with thumbnails', await E("document.querySelectorAll('.ag-att-i .th img').length")==2)
        check('…and they are added to Assets', await E(nAssets)==a0+2)
        check('the model can see: no note', not await E("!!document.querySelector('.ag-att-note')"))
        check('Send is enabled by attachments alone', await E("!document.querySelector('#agSend').disabled"))
        await E("se.setSettings({model:'meta-llama/llama-4-maverick'}); AP.render()")
        check('a model that can’t see: a note under the chips', 'can’t see pictures' in (await E("(document.querySelector('.ag-att-note')||{}).textContent||''")))
        await E("se.setSettings({model:'anthropic/claude-sonnet-5.5'}); AP.render()")

        # "@" references
        await pg.click('#agText'); await pg.keyboard.type('Use @')
        check('typing "@" opens the list of attachments', await E("!document.querySelector('#agAtMenu').hidden && document.querySelectorAll('#agAtMenu .ag-at-o').length===2"))
        check('…above the text, starting near the "@"', await E("""(()=>{const m=document.querySelector('#agAtMenu').getBoundingClientRect(), t=document.querySelector('#agText').getBoundingClientRect(), a=document.querySelector('#agent').getBoundingClientRect();
          return m.bottom<=t.top+6 && m.left>=a.left && m.right<=a.right})()"""))
        await pg.screenshot(path=OUT+'agent-attach-at.png', clip={'x':1100,'y':52,'width':340,'height':848})
        await pg.keyboard.press('Enter'); await pg.keyboard.type('and put @lo')
        check('Enter inserts the first; typing filters the list', await E("document.querySelectorAll('#agAtMenu .ag-at-o').length===1 && document.querySelector('#agAtMenu b').textContent==='logo.svg'"))
        await pg.keyboard.press('Escape')
        check('Esc closes the list (and keeps the text)', await E("document.querySelector('#agAtMenu').hidden && document.querySelector('#agText').value.endsWith('@lo')"))
        for _ in range(3): await pg.keyboard.press('Backspace')
        await pg.keyboard.type('@'); await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Tab'); await pg.keyboard.type('top left')
        check('↑↓ choose, Tab inserts too', await E("document.querySelector('#agText').value")=='Use @rocket.png and put @logo.svg top left')
        check('references are coloured in the text', await E("[...document.querySelectorAll('#agHL .ag-ref')].map(s=>s.textContent).join()")=='@rocket.png,@logo.svg')
        check('…the coloured copy lines up with the textarea', await E("""(()=>{const h=document.querySelector('#agHL'), t=document.querySelector('#agText'); const a=h.getBoundingClientRect(), b=t.getBoundingClientRect();
          return Math.abs(a.left-b.left)<1 && Math.abs(a.top-b.top)<1 && getComputedStyle(t).color==='rgba(0, 0, 0, 0)' && getComputedStyle(h).paddingLeft===getComputedStyle(t).paddingLeft})()"""))
        await pg.screenshot(path=OUT+'agent-attach-ref.png', clip={'x':1100,'y':52,'width':340,'height':848})
        # Backspace right after a reference removes it whole
        await E("(()=>{const t=document.querySelector('#agText'); const i=t.value.indexOf(' top'); t.focus(); t.setSelectionRange(i,i)})()")
        await pg.keyboard.press('Backspace')
        check('Backspace removes a reference whole', await E("document.querySelector('#agText').value")=='Use @rocket.png and put  top left')
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(100)
        if await E("document.querySelector('#agText').value")!='Use @rocket.png and put @logo.svg top left':
            await E("(()=>{const t=document.querySelector('#agText'); t.value='Use @rocket.png and put @logo.svg top left'; t.dispatchEvent(new Event('input'))})()")

        # removing a chip: its reference turns red; the asset leaves Assets (nothing uses it)
        await pg.click('.ag-att-i[data-att] [data-attx]'); await pg.wait_for_timeout(200)
        check('× removes the attachment, and its asset leaves Assets', await E("document.querySelectorAll('.ag-att-i').length")==1 and await E(nAssets)==a0+1)
        check('…its reference becomes plain red text (still editable)', await E("[...document.querySelectorAll('#agHL .ag-ref-x')].map(s=>s.textContent).join()")=='@rocket.png' and await E("document.querySelector('#agText').value.startsWith('Use @rocket.png')"))
        pos=await E("(()=>{const r=document.querySelector('#agHL .ag-ref-x').getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]})()")
        await pg.mouse.move(*pos); await pg.wait_for_timeout(150)
        check('…hovering it says why', 'rocket.png isn’t attached any more' in await E("(()=>{const t=document.getElementById('agRefTip'); return t && !t.hidden ? t.textContent : ''})()"))
        await pg.screenshot(path=OUT+'agent-attach-broken.png', clip={'x':1100,'y':52,'width':340,'height':848})
        check('…and Send stays enabled', await E("!document.querySelector('#agSend').disabled"))
        await pg.set_input_files('#agAttFile',[rocket]); await pg.wait_for_timeout(400)
        check('attaching the same name again turns it back into a reference', await E("[...document.querySelectorAll('#agHL .ag-ref')].map(s=>s.textContent).join()")=='@rocket.png,@logo.svg')
        await pg.set_input_files('#agAttFile',[txt]); await pg.wait_for_timeout(300)
        check('…a text file is refused with a message', await E("document.querySelectorAll('.ag-att-i').length")==2 and 'PNG, JPG' in await E("document.querySelector('#toast').textContent"))
        await pg.set_input_files('#agAttFile',extra); await pg.wait_for_timeout(500)
        check('up to 4 per message', await E("document.querySelectorAll('.ag-att-i').length")==4 and 'Up to 4' in await E("document.querySelector('#toast').textContent"))
        for _ in range(2): await pg.click('.ag-att-i:last-child [data-attx]')
        await pg.wait_for_timeout(100)

        # paste and drop
        await E("""(()=>{const t=document.querySelector('#agText'), d=new DataTransfer(); d.items.add(new File([new Uint8Array([60,115,118,103,32,120,109,108,110,115,61,34,104,116,116,112,58,47,47,119,119,119,46,119,51,46,111,114,103,47,50,48,48,48,47,115,118,103,34,47,62])],'pasted.svg',{type:'image/svg+xml'}));
          t.dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()"""); await pg.wait_for_timeout(300)
        check('pasting a file into the prompt attaches it', 'pasted.svg' in await E("[...document.querySelectorAll('.ag-att-i b')].map(b=>b.textContent).join()"))
        await pg.click('.ag-att-i:last-child [data-attx]'); await pg.wait_for_timeout(100)
        await E("""window.__dt=(()=>{const d=new DataTransfer(); d.items.add(new File([new Uint8Array([60,115,118,103,32,120,109,108,110,115,61,34,104,116,116,112,58,47,47,119,119,119,46,119,51,46,111,114,103,47,50,48,48,48,47,115,118,103,34,47,62])],'dropped.svg',{type:'image/svg+xml'})); return d})();
          document.querySelector('#agBody').dispatchEvent(new DragEvent('dragover',{dataTransfer:__dt,bubbles:true,cancelable:true}))""")
        check('dragging files over the panel shows the drop target over the whole panel', await E("""(()=>{const o=document.getElementById('agDropOver'), a=document.querySelector('#agent').getBoundingClientRect(); if(!o||o.hidden) return false; const r=o.getBoundingClientRect();
          return r.left>=a.left && r.right<=a.right && r.height>a.height*0.8 && /Drop to attach/.test(o.textContent)})()"""))
        await pg.screenshot(path=OUT+'agent-attach-drop.png', clip={'x':1100,'y':52,'width':340,'height':848})
        await E("document.querySelector('#agBody').dispatchEvent(new DragEvent('drop',{dataTransfer:__dt,bubbles:true,cancelable:true}))"); await pg.wait_for_timeout(300)
        check('…dropping attaches them', await E("document.getElementById('agDropOver').hidden") and 'dropped.svg' in await E("[...document.querySelectorAll('.ag-att-i b')].map(b=>b.textContent).join()"))
        await pg.click('.ag-att-i:last-child [data-attx]'); await pg.wait_for_timeout(100)
        await pg.screenshot(path=OUT+'agent-attach-compose.png', clip={'x':1100,'y':52,'width':340,'height':848})

        # send: the model gets the asset ids and the pictures; the message shows thumbnails
        n0=await E("st.doc.layers.length")
        await pg.click('#agSend'); await pg.wait_for_timeout(1500)
        first=bodies[0]['messages']; u=[m for m in first if m['role']=='user'][-1]['content']
        check('the message goes with the pictures (a model that can see)', isinstance(u,list) and [x['type'] for x in u]==['text','image_url','image_url'], [x['type'] for x in u] if isinstance(u,list) else u[:80])
        check('…as PNG (the SVG too)', isinstance(u,list) and all(x['image_url']['url'].startswith('data:image/png;base64,') for x in u[1:]))
        t0=u[0]['text'] if isinstance(u,list) else u
        check('…and the text lists each file with its asset id', '<attachments' in t0 and '@rocket.png: asset ' in t0 and '@logo.svg: asset ' in t0 and 'SVG (placed as editable layers)' in t0)
        check('the agent places the attached image with place_image', await E("st.doc.layers.length")==n0+1 and await E("st.doc.layers.some(l=>l.type==='image' && l.name==='Rocket')"))
        check('the chips are cleared after sending', await E("document.querySelector('#agAtt').hidden && document.querySelector('#agText').value===''"))
        check('the sent message shows thumbnails above it', await E("document.querySelectorAll('.ag-user-att .th img').length")==2)
        check('…and its references stay coloured', await E("[...document.querySelectorAll('.ag-user .ag-ref')].map(s=>s.textContent).join()")=='@rocket.png,@logo.svg')
        check('the chat keeps which files were attached', await E("JSON.parse(ch.chatJSON()).turns.at(-1).att.map(a=>a.name).join()")=='logo.svg,rocket.png')
        await pg.screenshot(path=OUT+'agent-attach-sent.png', clip={'x':1100,'y':52,'width':340,'height':848})
        # the next request doesn't send the pictures again (their names and ids stay)
        await pg.fill('#agText','Make it bigger'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(1000)
        later=bodies[-1]['messages']; old=[m for m in later if m['role']=='user'][0]['content']
        check('later requests don’t send the pictures again, but keep the ids', isinstance(old,str) and '@rocket.png: asset' in old and 'image_url' not in json.dumps(later))
        # removing an attachment of a sent message keeps its asset (the chat refers to it)
        await pg.set_input_files('#agAttFile',[rocket]); await pg.wait_for_timeout(300)
        a1=await E(nAssets); await pg.click('.ag-att-i [data-attx]'); await pg.wait_for_timeout(100)
        check('× on a new attachment removes its unused asset', await E(nAssets)==a1-1)
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R,indent=1,ensure_ascii=False)); print('FAILS',F)
        await b.close()
asyncio.run(main())
