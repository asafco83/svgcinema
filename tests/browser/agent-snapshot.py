import asyncio, sys, json, os, base64, io
from PIL import Image
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The design agent looking at its own work and the Test checks: snapshot (a PNG of the canvas sent to
# the model, at most 3 per request, a thumbnail in the steps, the playhead left where it was), the agent
# Test's "Can see images", and the image Test on a Custom service (failing, then passing; the vector
# model must return SVG). No real provider: Playwright answers the URLs with scripted replies.
CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET, POST, OPTIONS'}
def png(color, size=(64,64)):
    im=Image.new('RGB',size,color); im.paste((220,30,30),(20,20,44,44))  # a subject on a flat background
    b=io.BytesIO(); im.save(b,'PNG'); return base64.b64encode(b.getvalue()).decode()
SVG=base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M5 0L10 10H0z"/></svg>').decode()
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
        S={'img':'404','bodies':[]}
        async def chat(r):
            q=r.request
            if q.method=='OPTIONS': return await r.fulfill(status=204,headers=CORS)
            if q.method=='GET': return await r.fulfill(status=404,headers=CORS,body='')
            body=json.loads(q.post_data); S['bodies'].append(body); msgs=body['messages']
            names=[t['function']['name'] for t in body.get('tools',[])]
            if 'ping' in names: out=oai(None,[('ping',{})])
            elif not names:  # the "Can see images" check
                saw=any(isinstance(m.get('content'),list) and any(c.get('type')=='image_url' for c in m['content']) for m in msgs)
                out=oai('Red' if saw else 'I cannot see it')
            else:
                last=[i for i,m in enumerate(msgs) if m['role']=='user' and isinstance(m['content'],str)][-1]
                tools=[m for m in msgs[last:] if m['role']=='tool']
                S['offered']=names
                if not tools: out=oai('Let me look.',[('snapshot',{'time':1})])
                elif len(tools)==1: out=oai(None,[('snapshot',{}),('snapshot',{}),('snapshot',{})])
                else: out=oai('It looks right.')
            await r.fulfill(status=200,headers={**CORS,'content-type':'text/event-stream'},body=out)
        async def custom(r):
            q=r.request
            if q.method=='OPTIONS': return await r.fulfill(status=204,headers=CORS)
            if q.url.endswith('/chat/completions'): return await chat(r)
            if q.url.endswith('/images/generations'):
                body=json.loads(q.post_data)
                if S['img']=='404': return await r.fulfill(status=404,headers={**CORS,'content-type':'application/json'},body='{"error":{"message":"Not found"}}')
                if body.get('output_format')=='svg': return await r.fulfill(status=200,headers={**CORS,'content-type':'application/json'},body=json.dumps({'data':[{'b64_json':SVG}]}))
                return await r.fulfill(status=200,headers={**CORS,'content-type':'application/json'},body=json.dumps({'data':[{'b64_json':png((0,255,0))}]}))
            await r.fulfill(status=404,headers=CORS,body='')
        await pg.route('https://openrouter.ai/**', chat)
        await pg.route('https://api.example.test/**', custom)
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(1500)
        await pg.evaluate("localStorage.setItem('svgcinema:agent.keys', JSON.stringify({openrouter:'test-key'}))")
        await pg.reload(); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); }")
        E=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        async def idle():
            await pg.wait_for_function("!document.querySelector('#app').classList.contains('agent-busy')", timeout=15000); await pg.wait_for_timeout(150)

        await E("hi.setTime(0.5)")
        await pg.click('#bAgent'); await pg.wait_for_timeout(200)
        await pg.fill('#agText','Check how it looks'); await pg.press('#agText','Enter'); await idle()
        check('snapshot is offered to a model that can see', 'snapshot' in S.get('offered',[]))
        sys_prompt=S['bodies'][0]['messages'][0]['content']
        check('…and the prompt suggests one look at the end', 'call snapshot once' in sys_prompt)
        b2=S['bodies'][1]['messages']
        pic=[c for m in b2 if m['role']=='user' and isinstance(m['content'],list) for c in m['content'] if c.get('type')=='image_url']
        check('the picture goes to the model after the tool result', len(pic)==1 and pic[0]['image_url']['url'].startswith('data:image/png;base64,'))
        info=None
        if pic:
            im=Image.open(io.BytesIO(base64.b64decode(pic[0]['image_url']['url'].split(',',1)[1]))).convert('RGB')
            dw,dh=await E("[st.doc.w, st.doc.h]")
            colours=len(set(im.resize((48,27)).get_flattened_data()))
            info={'size':im.size,'colours':colours}
            check('…a PNG of the canvas, 768 px on its long side, with the artwork in it', max(im.size)==768 and abs(im.size[0]/im.size[1]-dw/dh)<0.02 and colours>8, info)
        res=[m for m in b2 if m['role']=='tool']
        check('…the tool result says the time', res and json.loads(res[0]['content'])['time']==1, res[:1])
        b3=S['bodies'][2]['messages']; t3=[json.loads(m['content']) for m in b3 if m['role']=='tool'][-3:]
        check('at most 3 snapshots per request: the 4th is refused', 'error' not in t3[0] and 'error' not in t3[1] and 'No snapshots left' in t3[2].get('error',''), t3)
        check('…the pictures of this request go along (3: the first look and two more)', len([c for m in b3 if m['role']=='user' and isinstance(m['content'],list) for c in m['content'] if c.get('type')=='image_url'])==3)
        check('the playhead is where it was', abs(await E("st.S.time")-0.5)<1e-6)
        check('nothing changed: no undo step', not await E("!!document.querySelector('[data-act=undo]')"))
        th=await E("[...document.querySelectorAll('.ag-step')].filter(s=>s.querySelector('.ag-thumb')).length")
        check('the steps show what it looked at', th>=1 and 'Looked at the canvas' in await E("document.querySelector('.ag-step').textContent"), th)
        saved=await E("(async()=>{const ch=await import('/src/agent/chat.ts'); return ch.chatJSON()})()")
        check('pictures aren’t kept in the chat', 'base64' not in saved and '"image"' not in saved)

        # the agent Test: can it see?
        await pg.click('[data-act=settings]'); await pg.wait_for_timeout(200)
        await pg.select_option('#agModel','__other'); await pg.fill('#agModelName','vendor/new-model'); await pg.press('#agModelName','Tab')
        check('a model the list doesn’t know isn’t assumed to see', not await E("(async()=>{const s=await import('/src/agent/settings.ts'); return s.canSee()})()"))
        await pg.click('[data-act=test]'); await pg.wait_for_function("document.querySelectorAll('.ag-checks .ag-chk').length>=4")
        chk=await E("[...document.querySelectorAll('.ag-checks .ag-chk')].map(c=>c.className.split(' ')[1]+':'+c.textContent.trim().slice(0,24))")
        check('the Test checks whether it can see images', any(c.startswith('ok:Can see images') for c in chk), chk)
        check('…and then snapshot is offered to it', await E("(async()=>{const s=await import('/src/agent/settings.ts'); return s.canSee()})()"))

        # a Custom image service: images only after its Test passes
        await pg.select_option('#agProv','custom'); await pg.wait_for_timeout(100)
        await pg.fill('#agBase','https://api.example.test/v1'); await pg.press('#agBase','Tab')
        await pg.fill('#agModelName','chat-model'); await pg.press('#agModelName','Tab')
        await pg.select_option('#agImgProv','custom'); await pg.wait_for_timeout(100)
        cs=await E("(()=>({same:!!document.querySelector('[data-act=imgsame][aria-checked=true]'), base:!!document.querySelector('#agImgBase'), key:!!document.querySelector('#agImgKey'), alert:!!document.querySelector('.ag-alert')}))()")
        check('Custom images: same address and key as the agent, by default', cs['same'] and not cs['base'] and not cs['key'], cs)
        check('…and it says images wait for the Test', cs['alert'])
        await pg.fill('#agImgModel','img-model'); await pg.press('#agImgModel','Tab')
        await pg.click('[data-act=imgtest]'); await pg.wait_for_function("!document.querySelector('[data-act=imgtest]').disabled"); await pg.wait_for_timeout(150)
        f=await E("({chk:[...document.querySelectorAll('.ag-checks .ag-chk')].map(c=>c.textContent.trim()), bad:(document.querySelector('.ag-bad')||{}).textContent})")
        check('a service without an image endpoint: the Test says so, “Not working”', any('Can’t make images' in c and '404' in c for c in f['chk']) and f['bad']=='Not working', f)
        check('…and the agent gets no image tool', not await E("(async()=>{const t=await import('/src/agent/tools.ts'); return t.offeredTools().includes('generate_image')})()"))
        await pg.screenshot(path=OUT+'agent-custom-images.png', clip={'x':1100,'y':52,'width':340,'height':848})
        S['img']='ok'
        await pg.click('[data-act=imgtest]'); await pg.wait_for_function("!document.querySelector('[data-act=imgtest]').disabled"); await pg.wait_for_timeout(150)
        f=await E("({chk:[...document.querySelectorAll('.ag-checks .ag-chk')].map(c=>c.className.split(' ')[1]+':'+c.textContent.trim()), bad:!!document.querySelector('.ag-bad'), alert:!!document.querySelector('.ag-alert')})")
        check('once it makes images: checks pass, transparency handled, no warning', any(c.startswith('ok:Makes images') for c in f['chk']) and any(c.startswith('ok:Transparent background') for c in f['chk']) and not f['bad'] and not f['alert'], f)
        check('…and the agent can generate images', await E("(async()=>{const t=await import('/src/agent/tools.ts'); return t.offeredTools().includes('generate_image')})()"))
        await pg.select_option('#agVecSel','__other'); await pg.fill('#agVecModel','vec-model'); await pg.press('#agVecModel','Tab')
        check('a Custom vector model waits for its Test', not await E("(async()=>{const t=await import('/src/agent/tools.ts'); return t.offeredTools().includes('generate_vector')})()"))
        await pg.click('[data-act=imgtest]'); await pg.wait_for_function("!document.querySelector('[data-act=imgtest]').disabled"); await pg.wait_for_timeout(150)
        chk=await E("[...document.querySelectorAll('.ag-checks .ag-chk')].map(c=>c.className.split(' ')[1]+':'+c.textContent.trim())")
        check('…the Test checks that it returns SVG, then it is offered', any(c.startswith('ok:Vector model makes SVG') for c in chk) and await E("(async()=>{const t=await import('/src/agent/tools.ts'); return t.offeredTools().includes('generate_vector')})()"), chk)
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
