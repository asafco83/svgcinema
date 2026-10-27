import asyncio, sys, json, os, base64, io
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The design agent making images and vector: the Images settings (OpenRouter's live model list), the
# confirm card with its price and editable prompt, Cancel, Don't ask again and the cost line with Ask
# first again, the generating card, a green background removed, place_image, a vector model's SVG
# imported as layers, and Stop while an image is being made. No real provider: Playwright answers
# OpenRouter's URLs with scripted replies and a test key.
CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, POST, OPTIONS'}
def rocket_png():
    im=Image.new('RGB',(200,200),(0,255,0)); d=ImageDraw.Draw(im)
    d.polygon([(100,20),(130,80),(130,170),(70,170),(70,80)],fill=(240,236,224))
    b=io.BytesIO(); im.save(b,'PNG'); return base64.b64encode(b.getvalue()).decode()
PNG=rocket_png()
SVG=base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle id="Puff 1" cx="30" cy="50" r="20" fill="#ddd"/><circle id="Puff 2" cx="60" cy="50" r="24" fill="#eee"/><circle id="Puff 3" cx="85" cy="55" r="14" fill="#ccc"/></svg>').decode()
def oai(text=None, tools=None):
    s=''
    if text: s+='data: '+json.dumps({'choices':[{'index':0,'delta':{'content':text}}]})+'\n\n'
    for n,(name,args) in enumerate(tools or []):
        s+='data: '+json.dumps({'choices':[{'index':0,'delta':{'tool_calls':[{'index':n,'id':f'c{n}','function':{'name':name,'arguments':json.dumps(args)}}]}}]})+'\n\n'
    s+='data: '+json.dumps({'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if tools else 'stop'}]})+'\n\n'
    return s+'data: [DONE]\n\n'
CAT={'data':[{'id':'openai/gpt-image-2.5-flare','name':'OpenAI: GPT Image Flare','supported_parameters':{'background':{'type':'enum','values':['auto','transparent','opaque']},'output_format':{'type':'enum','values':['png','webp']}}},
            {'id':'black-forest-labs/flux.2-pro','name':'Black Forest Labs: FLUX.2 Pro','supported_parameters':{'aspect_ratio':{'type':'enum','values':['1:1','3:2','2:3']}}},
            {'id':'recraft/recraft-v4-vector','name':'Recraft: Recraft V4 Vector','supported_parameters':{'output_format':{'type':'enum','values':['svg']}}}]}
# OpenRouter's general model list: chat prices per token, image models' price per output-image token
PRICES={'data':[{'id':'anthropic/claude-sonnet-5.5','pricing':{'prompt':'0.000002','completion':'0.00001'}},
               {'id':'openai/gpt-5.5','pricing':{'prompt':'0.000005','completion':'0.00003'}},
               {'id':'openai/gpt-image-2.5-flare','pricing':{'prompt':'0.000008','completion':'0.000008','image_output':'0.00003'}},
               {'id':'black-forest-labs/flux.2-pro','pricing':{'prompt':'0','completion':'0','image_output':'0.00000732421875'}},
               {'id':'recraft/recraft-v4-vector','pricing':{'prompt':'0','completion':'0','image_output':'0.0000191616766467066'}}]}
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(8000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        calls=[]; S={'mode':'image','delay':0.3}
        async def route(r):
            q=r.request; u=q.url
            if q.method=='OPTIONS': return await r.fulfill(status=204,headers=CORS)
            if u.endswith('/images/models'): return await r.fulfill(status=200,headers={**CORS,'content-type':'application/json'},body=json.dumps(CAT))
            if '/api/v1/models' in u and q.method=='GET': return await r.fulfill(status=200,headers={**CORS,'content-type':'application/json'},body=json.dumps(PRICES))
            if '/endpoints' in u: return await r.fulfill(status=200,headers={**CORS,'content-type':'application/json'},body=json.dumps({'data':{'endpoints':[{'pricing':[{'billable':'output_image','unit':'image','cost_usd':0.04}]}]}}))
            if u.endswith('/api/v1/images'):
                body=json.loads(q.post_data); calls.append(body); await asyncio.sleep(S['delay'])
                vec=body.get('output_format')=='svg'
                try:
                    return await r.fulfill(status=200,headers={**CORS,'content-type':'application/json'},body=json.dumps({'data':[{'b64_json':SVG if vec else PNG,'media_type':'image/svg+xml' if vec else 'image/png'}],'usage':{'cost':0.042}}))
                except Exception: return
            body=json.loads(q.post_data); msgs=body['messages']
            last=[i for i,m in enumerate(msgs) if m['role']=='user'][-1]
            tools=[m for m in msgs[last:] if m['role']=='tool']
            names=[t['function']['name'] for t in body.get('tools',[])]
            S['offered']=names
            if S['mode']=='vector':
                out=oai('Smoke as vector parts.',[('generate_vector',{'prompt':'three puffs of smoke','name':'Smoke'})]) if not tools else oai('Done.')
            elif not tools: out=oai('Making the rocket.',[('generate_image',{'prompt':'Cartoon rocket','name':'Rocket','transparent':True})])
            elif len(tools)==1:
                res=json.loads(tools[0]['content'])
                out=oai(None,[('place_image',{'asset':res['asset'],'x':300,'y':300,'width':150})]) if 'asset' in res else oai('All right, no image.')
            else: out=oai('Placed the rocket.')
            await r.fulfill(status=200,headers={**CORS,'content-type':'text/event-stream'},body=out)
        await pg.route('https://openrouter.ai/**', route)
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(1500)
        await pg.evaluate("localStorage.setItem('svgcinema:agent.keys', JSON.stringify({openrouter:'test-key'}))")
        await pg.reload(); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); }")
        E=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        async def send(t):
            await pg.fill('#agText',t); await pg.press('#agText','Enter')
        async def idle():
            await pg.wait_for_function("!document.querySelector('#app').classList.contains('agent-busy')", timeout=15000); await pg.wait_for_timeout(150)

        await pg.click('#bAgent'); await pg.wait_for_timeout(200)
        await pg.click('[data-act=settings]'); await pg.wait_for_timeout(700)
        st=await E("""(()=>{const h=[...document.querySelectorAll('.ag-sec h3')].map(h=>h.textContent.trim());
          return {secs:h, prov:document.querySelector('#agImgProv').value, models:[...document.querySelectorAll('#agImgSel option')].map(o=>o.textContent.split(' · ')[0]),
            vec:[...document.querySelectorAll('#agVecSel option')].map(o=>o.textContent), key:!!document.querySelector('#agImgKey')}})()""")
        check('Settings has an Images section after the agent model', st['secs'][:2]==['Agent model','Images'], st['secs'])
        check('…the agent’s OpenRouter key makes images too (no second key field)', st['prov']=='openrouter' and not st['key'], st)
        check('…image models come from OpenRouter’s live list, picture models only', st['models'][:2]==['GPT Image Flare','FLUX.2 Pro'] and 'Recraft V4 Vector' not in st['models'], st['models'])
        check('…vector: drawn by the agent, or a vector model', st['vec'][:2]==['Drawn by the agent','Recraft V4 Vector · about $0.08'], st['vec'])
        pr=await E("""(()=>{const v=s=>{const e=document.querySelector(s); return e&&e.closest('.ag-ps').querySelector('.ag-ps-v').textContent};
          return {agent:v('#agModel'), img:v('#agImgSel'), vec:v('#agVecSel'), opts:[...document.querySelectorAll('#agModel option')].map(o=>o.textContent),
            group:(document.querySelector('#agImgSel optgroup')||{}).label}})()""")
        check('the agent model shows its price per million tokens (from OpenRouter’s list)', pr['agent']=='claude-sonnet-5.5$2 · $10 /M' and 'openai/gpt-5.5 · $5 · $30 /M' in pr['opts'], pr)
        check('…image models show about how much one image costs', pr['img']=='GPT Image Flareabout $0.03' and 'per image' in (pr['group'] or ''), pr)
        check('…a model the list has no price for shows none', 'Other model…' in pr['opts'] and all('·' not in o for o in pr['opts'] if o.startswith('Other')))
        await pg.select_option('#agImgProv','openai'); await pg.wait_for_timeout(150)
        check('another service asks for its own key and has no vector models', await E("!!document.querySelector('#agImgKey') && !document.querySelector('#agVecSel')"))
        await pg.select_option('#agImgProv','openrouter'); await pg.wait_for_timeout(150)
        await pg.click('[data-act=back]'); await pg.wait_for_timeout(150)

        u0=await E("st.S.undo.length")
        await send('Make a cartoon rocket and place it')
        await pg.wait_for_selector('.ag-imgask'); await pg.wait_for_timeout(150)
        card=await E("document.querySelector('.ag-imgask').textContent")
        check('the image tools are offered', 'generate_image' in S['offered'] and 'place_image' in S['offered'] and 'generate_vector' not in S['offered'])
        check('asking first: the card shows model, size, background and price', all(x in card for x in ['Generate 1 image?','GPT Image Flare · OpenRouter','1024 × 1024','Transparent','about $0.04']), card)
        check('…and nothing is generated before Generate', not calls)
        check('…the footer says it waits', 'confirm the image' in await E("document.querySelector('#agFoot').textContent"))
        await pg.fill('#agImgPrompt','Cartoon rocket, side view, flat colours')
        S['delay']=1.2
        await pg.click('[data-act=imggo]'); await pg.wait_for_timeout(500)
        check('while it is made, the generating card shows', await E("!!document.querySelector('.ag-gen') && document.querySelector('.ag-gen').textContent.includes('Generating image “Rocket”')"))
        await idle(); S['delay']=0.3
        check('Generate uses the prompt as edited', calls and calls[0]['prompt']=='Cartoon rocket, side view, flat colours' and calls[0]['model']=='openai/gpt-image-2.5-flare' and calls[0].get('background')=='transparent', calls[:1])
        a=await E("""(async()=>{const a=Object.values(st.ASSETS).find(a=>a.name==='Rocket'); if(!a) return null;
          const im=new Image(); im.src=a.data; await im.decode(); const c=document.createElement('canvas'); c.width=im.width; c.height=im.height;
          const x=c.getContext('2d'); x.drawImage(im,0,0); return {mime:a.mime, corner:x.getImageData(0,0,1,1).data[3], mid:x.getImageData(100,100,1,1).data[3]}})()""")
        check('the image is an asset; its green background was removed', a and a['mime']=='image/png' and a['corner']==0 and a['mid']==255, a)
        lay=await E("(()=>{const l=st.doc.layers.find(l=>l.type==='image'&&l.name==='Rocket'); return l&&{w:l.geo.w, x:l.geo.x}})()")
        check('place_image put it on the canvas at the size asked', lay and abs(lay['w']-150)<0.5 and abs(lay['x']-225)<0.5, lay)
        check('…one undo step for the request', await E("st.S.undo.length")==u0+1)
        steps=await E("[...document.querySelectorAll('.ag-step')].map(s=>s.textContent)")
        check('the steps say what it made, approved, with the cost', steps and 'Generated image “Rocket”' in steps[0] and 'approved' in steps[0] and '$0.042' in steps[0], steps)
        check('…no cost line when it asked first', not await E("!!document.querySelector('.ag-cost')"))

        # cancel
        n0=len(calls)
        await send('Make another rocket'); await pg.wait_for_selector('.ag-imgask')
        await pg.click('[data-act=imgcancel]'); await idle()
        check('Cancel generates nothing and the agent is told', len(calls)==n0 and 'Didn’t generate' in await E("document.querySelector('#agBody').textContent"))

        # don't ask again, then the cost line
        await send('Make another rocket'); await pg.wait_for_selector('.ag-imgask')
        await pg.check('#agDontAsk'); await pg.click('[data-act=imggo]'); await idle()
        check('Don’t ask again turns asking off', await E("localStorage.getItem('svgcinema:agent.confirmImages')")=='false')
        n1=len(calls)
        await send('And one more'); await idle()
        check('…then the next image is made without the card', len(calls)==n1+1 and not await E("!!document.querySelector('.ag-imgask')"))
        cl=await E("(document.querySelector('.ag-cost')||{}).textContent||''")
        check('…with a cost line and Ask first again', 'Generated · GPT Image Flare · $0.042' in cl and 'Ask first again' in cl, cl)
        await pg.screenshot(path=OUT+'agent-images.png')
        await pg.click('.ag-cost [data-act=askimages]'); await pg.wait_for_timeout(150)
        check('Ask first again turns it back on', await E("localStorage.getItem('svgcinema:agent.confirmImages')")!='false' and not await E("!!document.querySelector('.ag-cost [data-act=askimages]')"))

        # Stop while generating
        S['delay']=3
        await send('Rocket again'); await pg.wait_for_selector('.ag-imgask'); await pg.click('[data-act=imggo]'); await pg.wait_for_timeout(400)
        nA=await E("Object.keys(st.ASSETS).length")
        await pg.click('#agStop'); await idle(); S['delay']=0.3
        check('Stop while an image is made ends the request, nothing added', await E("Object.keys(st.ASSETS).length")==nA and 'Stopped' in await E("document.querySelector('#agBody').textContent"))

        # vector model
        await pg.click('[data-act=settings]'); await pg.wait_for_timeout(300)
        await pg.select_option('#agVecSel','recraft/recraft-v4-vector'); await pg.click('[data-act=back]')
        await pg.evaluate("localStorage.setItem('svgcinema:agent.confirmImages','false')")
        S['mode']='vector'; nv=len(calls)
        await send('Add smoke'); await idle()
        check('with a vector model chosen, generate_vector is offered', 'generate_vector' in S['offered'])
        check('…it asks for SVG from the vector model', len(calls)==nv+1 and calls[-1].get('output_format')=='svg' and calls[-1]['model']=='recraft/recraft-v4-vector', calls[-1:])
        sm=await E("(()=>{const g=st.doc.layers.find(l=>l.name==='Smoke'); return g&&st.doc.layers.filter(l=>l.parent===g.id).map(l=>l.name)})()")
        check('…and imports it as editable layers', sm and len(sm)==3 and 'Puff 1' in sm, sm)
        await pg.evaluate("localStorage.removeItem('svgcinema:agent.confirmImages')")
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
