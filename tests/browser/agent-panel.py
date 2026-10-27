import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The design agent panel: first open, settings and Test, a request with its steps and one undo step,
# editing paused while it runs, the delete confirmation, errors, Alt+A, and the chat saved in the
# project file. No real provider: Playwright answers OpenRouter's URL with scripted streams.
CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, OPTIONS'}
def oai(text=None, tools=None):
    s=''
    if text: s+='data: '+json.dumps({'choices':[{'index':0,'delta':{'content':text}}]})+'\n\n'
    for n,(name,args) in enumerate(tools or []):
        s+='data: '+json.dumps({'choices':[{'index':0,'delta':{'tool_calls':[{'index':n,'id':f'c{n}','function':{'name':name,'arguments':json.dumps(args)}}]}}]})+'\n\n'
    s+='data: '+json.dumps({'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if tools else 'stop'}]})+'\n\n'
    return s+'data: [DONE]\n\n'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(8000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        mode={'m':'box','delay':0.0}
        async def route(r):
            q=r.request
            if q.method=='OPTIONS': return await r.fulfill(status=204,headers=CORS)
            # the public image model / price lists (read by Settings): unreachable here, so the built-in list is used
            if q.method=='GET': return await r.fulfill(status=404,headers=CORS,body='')
            if 'bad-key' in q.headers.get('authorization',''):
                return await r.fulfill(status=401,headers={**CORS,'content-type':'application/json'},body=json.dumps({'error':{'message':'No auth credentials found'}}))
            body=json.loads(q.post_data); msgs=body['messages']
            tools=[m for m in msgs[[i for i,m in enumerate(msgs) if m['role']=='user'][-1]:] if m['role']=='tool']
            if any(t['function']['name']=='ping' for t in body.get('tools',[])):
                return await r.fulfill(status=200,headers={**CORS,'content-type':'text/event-stream'},body=oai(None,[('ping',{})]))
            if mode['delay']: await asyncio.sleep(mode['delay'])
            if mode['m']=='box':
                if not tools: out=oai('Making a box.',[('add_shape',{'kind':'rect','name':'Agent box','x':40,'y':40,'w':80,'h':60})])
                elif len(tools)==1:
                    bid=json.loads(tools[0]['content'])['id']
                    out=oai(None,[('apply_preset',{'preset':'fade-in','ids':[bid],'at':0})])
                else: out=oai('Done: the box fades in.')
            elif mode['m']=='delete':
                if not tools:
                    bid=await pg.evaluate("st.doc.layers.find(l=>l.name==='Agent box').id")
                    out=oai(None,[('delete',{'ids':[bid]})])
                else: out=oai('Kept it.' if 'error' in tools[0]['content'] or 'kept' in tools[0]['content'].lower() else 'Deleted it.')
            await r.fulfill(status=200,headers={**CORS,'content-type':'text/event-stream'},body=out)
        await pg.route('https://openrouter.ai/**', route)
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("""async()=>{ window.st=await import('/src/core/state.ts'); window.zip=await import('/src/io/zip.ts');
          window.op=await import('/src/io/open.ts'); window.ch=await import('/src/agent/chat.ts'); }""")
        E=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)

        check('the panel starts closed', await E("document.querySelector('#agent').hidden"))
        await pg.click('#bAgent'); await pg.wait_for_timeout(250)
        check('the Agent button opens it, docked as a fifth column', await E("""(()=>{const a=document.querySelector('#agent'), r=a.getBoundingClientRect();
          return !a.hidden && document.querySelector('#app').classList.contains('agent-on') && Math.round(r.right)===1440 && r.width>=300 && document.querySelector('#bAgent').getAttribute('aria-pressed')==='true'})()"""))
        check('first open shows the setup, OpenRouter recommended', await E("""!!document.querySelector('.ag-setup') && document.querySelector('.ag-radio.on input').value==='openrouter'"""))
        check('…and the composer is hidden until a model is set up', await E("getComputedStyle(document.querySelector('#agComp')).display==='none' || document.querySelector('#agComp').hidden"))
        await pg.click('[data-act=continue]'); await pg.wait_for_timeout(200)
        check('Continue opens the settings with the key field focused', await E("document.activeElement && document.activeElement.id==='agKey'"))
        check('…the model select shows the default model', await E("document.querySelector('#agModel').value")=='anthropic/claude-sonnet-5.5')
        await pg.click('[data-act=test]'); await pg.wait_for_timeout(200)
        check('Test without a key says to add one', 'Add your API key' in await E("document.querySelector('.ag-chk').textContent"))
        await pg.fill('#agKey','bad-key'); await pg.press('#agKey','Tab'); await pg.click('[data-act=test]'); await pg.wait_for_timeout(700)
        check('Test with a refused key says so', 'refused' in await E("document.querySelector('#agBody').textContent"))
        await pg.fill('#agKey','test-key'); await pg.press('#agKey','Tab'); await pg.click('[data-act=test]'); await pg.wait_for_timeout(700)
        chk=await E("[...document.querySelectorAll('.ag-chk')].map(c=>c.className.split(' ')[1]+':'+c.textContent.trim().slice(0,22))")
        check('Test with a working key: reachable, model found, can use tools, then whether it can see', len(chk)==4 and all(c.startswith('ok:') for c in chk[:3]) and 'see images' in chk[3], chk)
        check('the key is kept in this browser only', await E("JSON.parse(localStorage.getItem('svgcinema:agent.keys')||'{}').openrouter")=='test-key')
        await pg.click('[data-act=back]'); await pg.wait_for_timeout(200)
        check('the Settings button is a cog (a closed toothed outline, not sun rays)', await E("(()=>{const p=document.querySelector('[data-act=settings] svg path'); return !!p && /Z$/.test(p.getAttribute('d')) && p.getAttribute('d').split('L').length>=32})()"))
        check('the empty chat shows examples and the composer', await E("document.querySelectorAll('.ag-hello .ag-ex').length>=2 && !!document.querySelector('#agText').offsetParent"))
        check('…the model chip names the model', await E("document.querySelector('#agModelChip').textContent.trim()")=='claude-sonnet-5.5')

        n0=await E("st.doc.layers.length"); u0=await E("st.S.undo.length")
        mode['delay']=0.6
        await pg.fill('#agText','Make a box and fade it in'); await pg.press('#agText','Enter'); await pg.wait_for_timeout(250)
        busy=await E("""(()=>({busy: document.querySelector('#app').classList.contains('agent-busy'), stop: !document.querySelector('#agStop').hidden,
          tools: getComputedStyle(document.querySelector('#tools')).pointerEvents}))()""")
        check('while it runs, editing is paused and Stop shows', busy['busy'] and busy['stop'] and busy['tools']=='none', busy)
        await pg.keyboard.press('r'); await pg.wait_for_timeout(50)
        check('…editing shortcuts do nothing', await E("st.S.tool")!='rect')
        await pg.wait_for_timeout(2400); mode['delay']=0
        turn=await E("""(()=>({n: document.querySelectorAll('.ag-step').length, reply: document.querySelector('#agBody').textContent,
          undo: !!document.querySelector('[data-act=undo]'), busy: document.querySelector('#app').classList.contains('agent-busy')}))()""")
        check('the request shows its steps and answer', turn['n']==2 and 'Done: the box fades in.' in turn['reply'], turn)
        check('…editing is back on afterwards', not turn['busy'])
        check('…it added one layer, as one undo step', await E("st.doc.layers.length")==n0+1 and await E("st.S.undo.length")==u0+1)
        check('…the Inspector shows the layer, not key easing', await E("st.S.keys.size")==0)
        await pg.click('[data-act=undo]'); await pg.wait_for_timeout(200)
        check('"Undo this request" rolls it back and hides itself', await E("st.doc.layers.length")==n0 and not await E("!!document.querySelector('[data-act=undo]')"))
        await pg.keyboard.press('Control+Shift+z'); await pg.wait_for_timeout(200)
        check('…redo brings it back', await E("st.doc.layers.some(l=>l.name==='Agent box')"))

        # delete: asks first
        mode['m']='delete'
        await pg.fill('#agText','Delete the box'); await pg.press('#agText','Enter'); await pg.wait_for_timeout(600)
        check('deleting layers asks first', await E("!!document.querySelector('[data-act=keep]') && document.querySelector('.ag-confirm').textContent.includes('Agent box')"))
        await pg.click('[data-act=keep]'); await pg.wait_for_timeout(600)
        check('…Keep keeps the layer', await E("st.doc.layers.some(l=>l.name==='Agent box')"))
        await pg.fill('#agText','Delete the box'); await pg.press('#agText','Enter'); await pg.wait_for_timeout(600)
        await pg.click('[data-act=delete]'); await pg.wait_for_timeout(600)
        check('…Delete deletes it', not await E("st.doc.layers.some(l=>l.name==='Agent box')"))

        # errors
        await E("localStorage.setItem('svgcinema:agent.keys', JSON.stringify({openrouter:'bad-key'}))")
        await pg.fill('#agText','Anything'); await pg.press('#agText','Enter'); await pg.wait_for_timeout(700)
        check('a refused key shows an error card with Try again and Settings', await E("!!document.querySelector('.ag-err [data-act=retry]') && !!document.querySelector('.ag-err [data-act=settings]')"))
        await E("localStorage.setItem('svgcinema:agent.keys', JSON.stringify({openrouter:'test-key'}))")
        await pg.screenshot(path=OUT+'agent-panel.png')

        # the chat travels with the project
        nturns=await E("ch.CHAT.turns.length")
        check('the chat is kept in this browser', len(json.loads(await E("localStorage.getItem('svgcinema:agent.chat')"))['turns'])==nturns)
        saved=await E("""(async()=>{ const blob=await zip.buildProject(); const z=await zip.readZip(await blob.arrayBuffer());
          window._proj=blob; return await z.text('agent-chat.json'); })()""")
        check('saving the project puts the chat in it', saved and json.loads(saved)['format']=='svgcinema-agent-chat' and len(json.loads(saved)['turns'])==nturns)
        check('…lean: steps keep no tool arguments or results', saved and all('args' not in st and 'result' not in st for t in json.loads(saved)['turns'] for st in t['steps']))
        await E("ch.clearChat()"); await pg.wait_for_timeout(100)
        await E("op.loadProjectFile(new File([_proj], 'p.SVGcinema'), null)"); await pg.wait_for_timeout(800)
        check('opening the project brings its chat back', await E("ch.CHAT.turns.length")==nturns and await E("document.querySelectorAll('.ag-user').length")==nturns)

        # Alt+A and the remembered state
        await pg.click('#wrap', position={'x':30,'y':30}); await pg.keyboard.press('Alt+a'); await pg.wait_for_timeout(200)
        check('Alt+A closes it', await E("document.querySelector('#agent').hidden && !document.querySelector('#app').classList.contains('agent-on')"))
        await pg.keyboard.press('Alt+a'); await pg.wait_for_timeout(200)
        check('…and opens it again', await E("!document.querySelector('#agent').hidden"))
        await pg.reload(); await pg.wait_for_timeout(2500)
        check('after a reload it is still open, with the chat', await E("!document.querySelector('#agent').hidden && document.querySelectorAll('.ag-user').length")==nturns)
        await pg.click('[data-act=settings]'); await pg.wait_for_timeout(150); await pg.click('[data-act=removekeys]'); await pg.wait_for_timeout(150)
        check('Remove keys forgets them', await E("localStorage.getItem('svgcinema:agent.keys')") in (None,'{}'))
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
