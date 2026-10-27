import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The design agent at its step limit: the "Paused at the step limit" card (done steps, the agent's list of
# what is left, Continue with the estimate + 2 spare, Change), Continue running in the same turn and the
# same undo step, and the "Continued" line in the steps. No real provider: scripted streams.
CORS={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST, OPTIONS'}
def oai(text=None, tools=None):
    s=''
    if text: s+='data: '+json.dumps({'choices':[{'index':0,'delta':{'content':text}}]})+'\n\n'
    for n,(name,args) in enumerate(tools or []):
        s+='data: '+json.dumps({'choices':[{'index':0,'delta':{'tool_calls':[{'index':n,'id':f'c{n}','function':{'name':name,'arguments':json.dumps(args)}}]}}]})+'\n\n'
    s+='data: '+json.dumps({'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if tools else 'stop'}]})+'\n\n'
    return s+'data: [DONE]\n\n'
shape=lambda name,x: ('add_shape',{'kind':'rect','name':name,'x':x,'y':40,'w':30,'h':30})
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(8000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        seen=[]
        async def route(r):
            q=r.request
            if q.method=='OPTIONS': return await r.fulfill(status=204,headers=CORS)
            if q.method=='GET': return await r.fulfill(status=404,headers=CORS,body='')
            body=json.loads(q.post_data); msgs=body['messages']
            seen.append(msgs)
            n=len(seen)
            if n==1: out=oai('Drawing the star.',[shape('Star head',300),shape('Star tail',340)])
            elif n==2: out=oai('I drew the shooting star, but reached the step limit before animating it.\n<left>\n- Streak it from the upper right to the lower left\n- Fade it in and out\n- Move it behind the planet\n</left>',[shape('Not run',0)])
            elif n==3: out=oai(None,[shape('Star glow',380)])
            else: out=oai('I drew the shooting star and, after you continued, finished it.')
            await r.fulfill(status=200,headers={**CORS,'content-type':'text/event-stream'},body=out)
        await pg.route('https://openrouter.ai/**', route)
        await pg.add_init_script("""localStorage.setItem('svgcinema:agent.keys', JSON.stringify({openrouter:'test-key'}));
          localStorage.setItem('svgcinema:agent.settings', JSON.stringify({provider:'openrouter', model:'anthropic/claude-sonnet-5.5', maxSteps:2}));""")
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("""async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.ch=await import('/src/agent/chat.ts'); }""")
        E=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        await pg.click('#bAgent'); await pg.wait_for_timeout(300)
        u0=await E("st.S.undo.length"); n0=await E("st.doc.layers.length")
        await pg.fill('#agText','create a shooting star animation in the background'); await pg.press('#agText','Enter')
        await pg.wait_for_selector('.ag-limit', timeout=8000); await pg.wait_for_timeout(200)
        card=await E("""(()=>{const c=document.querySelector('.ag-limit'), t=s=>(c.querySelector(s)||{}).textContent||'';
          return {head:t('.ag-card-h b'), of:t('.ag-card-h small'), on:c.querySelectorAll('.ag-lim-bar i.on').length, off:c.querySelectorAll('.ag-lim-bar i:not(.on)').length,
            done:t('.ag-lim-cap.done'), doneRows:c.querySelectorAll('.ag-lim-done .ag-step').length,
            leftCap:t('.ag-lim-left .ag-lim-cap'), left:[...c.querySelectorAll('.ag-lim-left .ag-step')].map(e=>e.textContent.trim()),
            go:t('[data-act=more]'), undo:!!c.querySelector('[data-act=undo]'), note:t('.ag-lim-note')}})()""")
        check('at the limit: a “Paused at the step limit” card, 2 of 2 steps', card['head']=='Paused at the step limit' and card['of']=='2 of 2 steps', card)
        check('…a bar of 2 done and 3 left', card['on']==2 and card['off']==3, [card['on'],card['off']])
        check('…Done · 2 steps, with the steps that ran', card['done'].strip().lower()=='done · 2 steps' and card['doneRows']==2, card['done'])
        check('…Left to do · about 3 steps, the agent’s own list', card['leftCap'].strip().lower()=='left to do · about 3 steps' and card['left']==['Streak it from the upper right to the lower left','Fade it in and out','Move it behind the planet'], card['left'])
        check('…Continue shows the estimate, and Undo is there', card['go'].strip()=='Continue· about 3 steps' and card['undo'], card['go'])
        check('…the note: up to 5 more steps (estimate + 2), one undo step, Change', 'up to 5 more steps (the estimate + 2 spare)' in card['note'] and 'Limit 2 steps' in card['note'] and 'Change' in card['note'], card['note'])
        txt=await E("[...document.querySelectorAll('.ag-turn .ag-text')].map(e=>e.textContent)")
        check('the reply reads without the list markup', any('reached the step limit' in t for t in txt) and not any('<left>' in t or 'Streak it' in t for t in txt), txt)
        check('the steps live in the card only (no second steps list, no Play)', await E("!document.querySelector('.ag-turn > .ag-steps') && !document.querySelector('[data-act=play]')"))
        check('the call made past the limit did not run', not await E("st.doc.layers.some(l=>l.name==='Not run')"))
        check('the list is kept in the chat', await E("ch.CHAT.turns[0].left.length")==3)
        await pg.screenshot(path=OUT+'agent-limit.png', clip={'x':1440-360,'y':0,'width':360,'height':900})
        await E("document.documentElement.dataset.theme='dark'"); await pg.wait_for_timeout(150)
        await pg.screenshot(path=OUT+'agent-limit-dark.png', clip={'x':1440-360,'y':0,'width':360,'height':900})
        await E("delete document.documentElement.dataset.theme"); await pg.wait_for_timeout(100)
        # Change opens Settings at the limit
        await pg.click('.ag-limit [data-act=limit]'); await pg.wait_for_timeout(250)
        check('Change opens Settings with Most steps per request focused', await E("document.activeElement && document.activeElement.id")=='agSteps')
        await pg.click('[data-act=back]'); await pg.wait_for_timeout(200)
        # Continue: same turn, same undo step
        await pg.click('.ag-limit [data-act=more]')
        await pg.wait_for_function("ch.CHAT.turns[0].outcome==='done'", timeout=8000); await pg.wait_for_timeout(250)
        check('Continue sends a continue message with the earlier steps in the history', len(seen)==4 and 'Continue' in seen[2][-1]['content'] and any(m['role']=='tool' for m in seen[2]), [m['role'] for m in seen[2]])
        check('…allowing the estimate + 2 (it was not capped after 1 more step)', not any('step limit' in (m.get('content') or '') for m in seen[3] if m['role']=='tool' and m is seen[3][-1]))
        check('…in the same turn: one user message', await E("ch.CHAT.turns.length")==1 and await E("document.querySelectorAll('.ag-user').length")==1)
        st=await E("""(()=>{const s=document.querySelector('.ag-steps'); return {h:s.querySelector('.ag-steps-h').textContent, rows:[...s.children].map(e=>e.className)}})()""")
        check('…the card is gone; the steps read “3 steps · one undo step”', not await E("!!document.querySelector('.ag-limit')") and st['h']=='3 steps· one undo step', st['h'])
        check('…with a “Continued” line before the third step', st['rows'][1:]==['ag-step i-add','ag-step i-add','ag-cont','ag-step i-add'], st['rows'])
        txt=await E("[...document.querySelectorAll('.ag-turn .ag-text')].map(e=>e.textContent)")
        check('…the new answer is the last word, and replaces what it said at the limit', txt and txt[-1].startswith('I drew the shooting star and, after you continued') and not any('reached the step limit' in t for t in txt), txt)
        check('one undo step for both parts', await E("st.S.undo.length")==u0+1 and await E("st.doc.layers.length")==n0+3)
        check('Play and Undo this request are back', await E("!!document.querySelector('[data-act=play]') && !!document.querySelector('.ag-acts [data-act=undo]')"))
        await pg.screenshot(path=OUT+'agent-limit-continued.png', clip={'x':1440-360,'y':0,'width':360,'height':900})
        if await E("!!document.querySelector('.ag-acts [data-act=undo]')"): await pg.click('.ag-acts [data-act=undo]'); await pg.wait_for_timeout(250)
        check('Undo this request takes back both parts', await E("st.doc.layers.length")==n0 and not await E("st.doc.layers.some(l=>/^Star /.test(l.name))"))
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R, indent=1, ensure_ascii=False)); print('FAILS', F)
        await b.close()
asyncio.run(main())
