import asyncio, sys, json, os, io, base64
from PIL import Image
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Vector or image for an unclear request: with Prefer vector off the agent's generate_image(either) shows
# the Vector | Image card (vector first, free when the agent draws it, no "Don't ask again"); picking vector
# has the agent draw it; "Make it as an image instead" shows what animation won't carry over, Keep vector,
# and Generate image (undo, then redo as an image without asking again, one undo step that brings the
# vector back). No real provider: scripted streams and a test key.
CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, POST, OPTIONS'}
def png():
    b=io.BytesIO(); Image.new('RGBA',(64,64),(200,60,60,255)).save(b,'PNG'); return base64.b64encode(b.getvalue()).decode()
PNG=png()
ROCKET='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="Body" x="40" y="20" width="20" height="50" fill="#eee"/><path id="Flame" d="M45 70 L55 70 L50 90 Z" fill="#f80"/></svg>'
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
        seen={'img':0,'redo':None}
        async def route(r):
            q=r.request; u=q.url
            if q.method=='OPTIONS': return await r.fulfill(status=204,headers=CORS)
            if q.method=='GET': return await r.fulfill(status=404,headers=CORS,body='')
            if u.endswith('/api/v1/images'):
                seen['img']+=1
                return await r.fulfill(status=200,headers={**CORS,'content-type':'application/json'},body=json.dumps({'data':[{'b64_json':PNG,'media_type':'image/png'}]}))
            body=json.loads(q.post_data); msgs=body['messages']
            last=[i for i,m in enumerate(msgs) if m['role']=='user'][-1]
            user=msgs[last]['content'] if isinstance(msgs[last]['content'],str) else ''
            tools=[m for m in msgs[last:] if m['role']=='tool']
            if 'undid your vector version' in user:
                seen['redo']=user
                if not tools: out=oai(None,[('generate_image',{'prompt':'a rocket picture','name':'Rocket'})])
                elif len(tools)==1:
                    res=json.loads(tools[0]['content'])
                    out=oai(None,[('place_image',{'asset':res['asset'],'x':300,'y':300,'width':120})]) if 'asset' in res else oai('No image.')
                else: out=oai('Done: the rocket is a picture now.')
            elif not tools: out=oai(None,[('generate_image',{'prompt':'a cartoon rocket','name':'Rocket','either':True})])
            elif len(tools)==1:
                res=json.loads(tools[0]['content'])
                out=oai(None,[('import_svg',{'svg':ROCKET,'name':'Rocket','x':300,'y':300})]) if res.get('chosen')=='vector' else oai('Stopped.')
            elif len(tools)==2:
                top=json.loads(tools[1]['content'])['ids'][0]
                flame=await pg.evaluate("st.doc.layers.find(l=>l.name==='Flame').id")
                out=oai(None,[('set_keyframes',{'id':flame,'prop':'scl','keys':[{'t':0,'v':[1,1]},{'t':0.3,'v':[1,0.8]}]}),('set_keyframes',{'id':top,'prop':'pos','keys':[{'t':0,'v':[300,300]},{'t':2,'v':[300,280]}]})])
            else: out=oai('I made the rocket as vector so the flame can flicker.')
            await r.fulfill(status=200,headers={**CORS,'content-type':'text/event-stream'},body=out)
        await pg.route('https://openrouter.ai/**', route)
        await pg.add_init_script("""localStorage.setItem('svgcinema:agent.keys', JSON.stringify({openrouter:'test-key'}));
          localStorage.setItem('svgcinema:agent.settings', JSON.stringify({provider:'openrouter', model:'anthropic/claude-sonnet-5.5', preferVector:false, vector:'agent'}));""")
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("""async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.ch=await import('/src/agent/chat.ts'); }""")
        E=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        await pg.click('#bAgent'); await pg.wait_for_timeout(300)
        n0=await E("st.doc.layers.length"); u0=await E("st.S.undo.length")
        await pg.fill('#agText','Add a cartoon rocket to the background'); await pg.press('#agText','Enter')
        await pg.wait_for_selector('.ag-kinds', timeout=8000); await pg.wait_for_timeout(150)
        card=lambda: E("""(()=>{const c=document.querySelector('.ag-imgask'); return {h:c.querySelector('.ag-card-h b').textContent,
          on:c.querySelector('.ag-kind.on').dataset.v, opts:[...c.querySelectorAll('.ag-kind')].map(b=>b.textContent.replace(/\\s+/g,' ').trim()),
          go:c.querySelector('[data-act=imggo]').textContent, kv:c.querySelector('.ag-kv').textContent, dont:!!document.querySelector('#agDontAsk'), hint:c.querySelector('.ag-kind-hint').textContent}})()""")
        k=await card()
        check('an unclear request with Prefer vector off: “Vector or image?”, vector picked first', k['h']=='Vector or image?' and k['on']=='vector', k)
        check('…the agent drawing the vector reads free; the image side has a price line', 'free' in k['opts'][0] and k['opts'][1].startswith('Image'), k['opts'])
        check('…no “Don’t ask again” (the choice is for this request)', not k['dont'])
        check('…vector: drawn by the agent, “Draw vector”', k['go']=='Draw vector' and 'The agent draws it' in k['kv'], k)
        await pg.fill('#agImgPrompt','a flat cartoon rocket')
        await pg.click('.ag-kind[data-v=image]'); await pg.wait_for_timeout(100)
        k=await card()
        check('switching to Image: its model, size and background, “Generate image”, the hint changes', k['on']=='image' and k['go']=='Generate image' and 'Size' in k['kv'] and 'Background' in k['kv'] and 'one piece' in k['hint'], k)
        check('…the edited prompt is kept across the switch', await E("document.querySelector('#agImgPrompt').value")=='a flat cartoon rocket')
        await pg.click('.ag-kind[data-v=vector]'); await pg.wait_for_timeout(100)
        await pg.screenshot(path=OUT+'agent-kind.png', clip={'x':1440-360,'y':0,'width':360,'height':900})
        await pg.click('[data-act=imggo]')
        await pg.wait_for_function("ch.CHAT.turns[0] && ch.CHAT.turns[0].outcome==='done'", timeout=8000); await pg.wait_for_timeout(300)
        steps=await E("[...document.querySelectorAll('.ag-step')].map(s=>s.textContent.trim())")
        check('picking vector: the agent draws it (no image made)', seen['img']==0 and await E("st.doc.layers.some(l=>l.name==='Flame')"), steps)
        check('…the step reads “Chose vector”, your pick, drawn by the agent', steps and steps[0].startswith('Chose vector for “Rocket”') and 'your pick' in steps[0], steps[:1])
        check('…with “Make it as an image instead” under it', await E("!!document.querySelector('.ag-asimg [data-act=asimage]')"))
        await pg.screenshot(path=OUT+'agent-kind-vector.png', clip={'x':1440-360,'y':0,'width':360,'height':900})
        u1=await E("st.S.undo.length"); n1=await E("st.doc.layers.length")
        # the redo card
        await pg.click('[data-act=asimage]'); await pg.wait_for_selector('.ag-redo-line', timeout=6000); await pg.wait_for_timeout(150)
        rd=await E("""(()=>({line:document.querySelector('.ag-redo-line').textContent, lost:(document.querySelector('.ag-lost')||{}).textContent||'',
          prompt:document.querySelector('#agRedoPrompt').value, go:!!document.querySelector('[data-act=redogo]'), keep:!!document.querySelector('[data-act=redokeep]')}))()""")
        check('the link opens the redo card: the vector request as one line, “replaced when you generate”', 'replaced when you generate' in rd['line'], rd['line'])
        check('…what won’t carry over (the Flame’s scale) and what is kept (Rocket’s position)', 'Won’t carry over' in rd['lost'] and 'Flame (scale)' in rd['lost'] and 'Rocket (position)' in rd['lost'] and 'kept' in rd['lost'], rd['lost'])
        check('…the vector’s prompt, Keep vector and Generate image', rd['prompt']=='a flat cartoon rocket' and rd['go'] and rd['keep'], rd['prompt'])
        check('…nothing changed yet', await E("st.doc.layers.length")==n1 and await E("st.S.undo.length")==u1)
        await pg.screenshot(path=OUT+'agent-kind-redo.png', clip={'x':1440-360,'y':0,'width':360,'height':900})
        await pg.click('[data-act=redokeep]'); await pg.wait_for_timeout(150)
        check('Keep vector: the card goes, the vector stays, the link is back', not await E("!!document.querySelector('.ag-redo-line')") and await E("st.doc.layers.length")==n1 and await E("!!document.querySelector('[data-act=asimage]')"))
        await pg.click('[data-act=asimage]'); await pg.wait_for_selector('[data-act=redogo]', timeout=6000)
        await pg.click('[data-act=redogo]')
        await pg.wait_for_function("ch.CHAT.turns.length===2 && ch.CHAT.turns[1].outcome==='done'", timeout=8000); await pg.wait_for_timeout(300)
        check('Generate image: the vector is gone and a picture is placed', not await E("st.doc.layers.some(l=>l.name==='Flame')") and await E("st.doc.layers.some(l=>l.type==='image')"))
        check('…made once, without asking again (no confirm card)', seen['img']==1 and not await E("!!document.querySelector('.ag-imgask')"))
        check('…the model was told to redo it as an image with the prompt', seen['redo'] is not None and 'a flat cartoon rocket' in seen['redo'] and 'without either' in seen['redo'])
        check('…the chat: the vector request folded as replaced, the new one “redo as an image”', 'replaced by an image' in await E("document.querySelector('.ag-fold').textContent") and 'redo as an image' in await E("document.querySelectorAll('.ag-who')[0].textContent"))
        check('…one undo step', await E("st.S.undo.length")==u1)
        await pg.click('.ag-acts [data-act=undo]'); await pg.wait_for_timeout(250)
        check('Undo this request brings the vector back', await E("st.doc.layers.some(l=>l.name==='Flame')") and not await E("st.doc.layers.some(l=>l.type==='image' && l.name==='Rocket')"))
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
