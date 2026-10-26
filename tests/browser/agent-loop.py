import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The design agent end to end in a real browser, with no real provider: Playwright answers the
# provider URLs with scripted streamed replies. A request runs through the real client (Anthropic and
# OpenAI-compatible formats), the loop and the tools on the sample scene, and ends as one undo step.
CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, OPTIONS'}
def ev(name, data): return f"event: {name}\ndata: {json.dumps(data)}\n\n"
def anth_reply(text=None, tool=None):
    s=ev('message_start',{'type':'message_start','message':{'id':'m'}}); i=0
    if text:
        s+=ev('content_block_start',{'type':'content_block_start','index':i,'content_block':{'type':'text','text':''}})
        s+=ev('content_block_delta',{'type':'content_block_delta','index':i,'delta':{'type':'text_delta','text':text}}); i+=1
    for n,(name,args) in enumerate(tool or []):
        s+=ev('content_block_start',{'type':'content_block_start','index':i,'content_block':{'type':'tool_use','id':f'tu{i}','name':name,'input':{}}})
        js=json.dumps(args); h=len(js)//2
        s+=ev('content_block_delta',{'type':'content_block_delta','index':i,'delta':{'type':'input_json_delta','partial_json':js[:h]}})
        s+=ev('content_block_delta',{'type':'content_block_delta','index':i,'delta':{'type':'input_json_delta','partial_json':js[h:]}}); i+=1
    s+=ev('message_delta',{'type':'message_delta','delta':{'stop_reason':'tool_use' if tool else 'end_turn'}})
    return s+ev('message_stop',{'type':'message_stop'})
def oai_reply(text=None, tool=None):
    s=''
    if text: s+='data: '+json.dumps({'choices':[{'index':0,'delta':{'content':text}}]})+'\n\n'
    for n,(name,args) in enumerate(tool or []):
        s+='data: '+json.dumps({'choices':[{'index':0,'delta':{'tool_calls':[{'index':n,'id':f'c{n}','function':{'name':name,'arguments':json.dumps(args)}}]}}]})+'\n\n'
    s+='data: '+json.dumps({'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if tool else 'stop'}]})+'\n\n'
    return s+'data: [DONE]\n\n'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(8000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        seen=[]
        async def anthropic(route):
            r=route.request
            if r.method=='OPTIONS': return await route.fulfill(status=204, headers=CORS)
            body=json.loads(r.post_data); seen.append(('anthropic', body, r.headers))
            last=body['messages'][-1]['content']
            results=[c for c in last if c.get('type')=='tool_result']
            if not results:
                out=anth_reply('Making a box.', [('add_shape',{'kind':'rect','name':'Box','x':40,'y':40,'w':80,'h':60})])
            elif len([m for m in body['messages'] if m['role']=='assistant'])==1:
                bid=json.loads(results[0]['content'])['id']
                out=anth_reply(None, [('apply_preset',{'preset':'fade-in','ids':[bid],'at':0}),('set_document',{'length':2})])
            else:
                out=anth_reply('Done: the box fades in over 0.6 s.')
            await route.fulfill(status=200, headers={**CORS,'content-type':'text/event-stream'}, body=out)
        async def openrouter(route):
            r=route.request
            if r.method=='OPTIONS': return await route.fulfill(status=204, headers=CORS)
            body=json.loads(r.post_data); seen.append(('openrouter', body, r.headers))
            if 'bad-key' in r.headers.get('authorization',''):
                return await route.fulfill(status=401, headers={**CORS,'content-type':'application/json'}, body=json.dumps({'error':{'message':'No auth credentials found'}}))
            done=any(m['role']=='tool' for m in body['messages'])
            out=oai_reply('There are many layers.') if done else oai_reply(None,[('get_scene',{})])
            await route.fulfill(status=200, headers={**CORS,'content-type':'text/event-stream'}, body=out)
        await pg.route('https://api.anthropic.com/**', anthropic)
        await pg.route('https://openrouter.ai/**', openrouter)
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("""async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts');
          window.lp=await import('/src/agent/loop.ts'); window.pv=await import('/src/agent/providers.ts');
          window.go=async(choice,text)=>{ const steps=[], streamed=[];
            const r=await lp.runAgent({client: pv.makeClient(choice), text, onStep:s=>steps.push(s), onText:t=>streamed.push(t)});
            return {outcome:r.outcome, reply:r.reply, changed:r.changed, steps:steps.map(s=>[s.name,s.ok]), streamed:streamed.join(''),
              error:r.error&&{kind:r.error.kind,message:r.error.message}, roles:r.added.map(m=>m.role)}; }; }""")
        E=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        n0=await E("st.doc.layers.length"); u0=await E("st.S.undo.length")

        r=await E("go({provider:'anthropic', model:'claude-test', key:'test-key'}, 'Make a box and fade it in')")
        check('an Anthropic request runs to the end', r['outcome']=='done' and r['reply']=='Done: the box fades in over 0.6 s.', r)
        check('…running the tools the model asked for, in order', r['steps']==[['add_shape',True],['apply_preset',True],['set_document',True]], r['steps'])
        check('…streaming its text as it comes', 'Making a box.' in r['streamed'], r['streamed'])
        box=await E("(()=>{const l=st.doc.layers.find(l=>l.name==='Box'); return l&&{op:l.t.op&&l.t.op.map(q=>q[0]), dur:st.doc.dur}})()")
        check('the box exists and fades in', box and box['op']==[0,0.6] and box['dur']==2, box)
        check('the whole request is one undo step', await E("st.S.undo.length")==u0+1)
        a=[s for s in seen if s[0]=='anthropic']
        b1,h1=a[0][1],a[0][2]
        check('it sent the system prompt, all tools and the scene', 'design agent' in b1['system'] and len(b1['tools'])>=19 and '<project' in b1['messages'][0]['content'][0]['text'])
        check('…with the key and the browser-access header', h1.get('x-api-key')=='test-key' and h1.get('anthropic-dangerous-direct-browser-access')=='true')
        check('…and the tool results went back each time', len(a)==3 and a[2][1]['messages'][-1]['content'][0]['type']=='tool_result', len(a))
        await E("hi.undo()"); await pg.wait_for_timeout(150)
        check('one undo takes it all back', await E("st.doc.layers.length")==n0 and await E("st.doc.dur")==3)

        r=await E("go({provider:'openrouter', model:'some/model', key:'test-key'}, 'How many layers are there?')")
        check('an OpenRouter request runs too', r['outcome']=='done' and r['steps']==[['get_scene',True]] and r['reply']=='There are many layers.', r)
        check('…reading only, so no undo step', not r['changed'] and await E("st.S.undo.length")==u0)
        o=[s for s in seen if s[0]=='openrouter'][0]
        check('…sent in the OpenAI shape, naming the app', o[1]['messages'][0]['role']=='system' and o[1]['tools'][0]['type']=='function' and o[2].get('x-title')=='SVGcinema', o[2].get('x-title'))

        r=await E("go({provider:'openrouter', model:'m', key:'bad-key'}, 'hi')")
        check('a refused key ends the request with the reason', r['outcome']=='error' and r['error']['kind']=='auth' and 'No auth credentials' in r['error']['message'], r)
        check('…and changes nothing', not r['changed'] and await E("st.S.undo.length")==u0)
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R,indent=1)); print('FAILS',F)
        await b.close()
asyncio.run(main())
