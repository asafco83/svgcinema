import asyncio, sys, json, os
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# The design agent's tools (src/agent/tools.ts), run on the sample scene in a real browser: the scene
# summary, every tool's change, the refusals (locked layer, wrong value, unknown id), the cleaned SVG
# import, delete with the user's answer, and that a whole request is one undo step.
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1440,'height':900}); pg.set_default_timeout(5000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("""async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts');
          window.ag=await import('/src/agent/tools.ts'); window.K=await import('/src/core/constants.ts'); window.rq=await import('/src/agent/request.ts');
          window.run=async(n,a,c)=>await ag.runTool(n,a,c||{}); }""")
        ev=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        async def run(n,a,ctx='{}'):
            return await ev(f"run({json.dumps(n)}, {json.dumps(a)}, {ctx})")
        lid=lambda n: ev(f"st.doc.layers.find(l=>l.name==='{n}').id")
        title=await lid('Title'); sun=await lid('Sun')
        n0=await ev("st.doc.layers.length"); u0=await ev("st.S.undo.length")

        # reading
        sc=(await run('get_scene',{}))['result']
        check('the scene summary has the canvas and length', sc['canvas']['w']==640 and sc['canvas']['length']==3, sc['canvas'])
        t=[l for l in sc['layers'] if l['name']=='Title'][0]
        check('…each layer with id, type and a measured box', t['id']==title and t['type']=='text' and len(t.get('box',[]))==4, t)
        check('…which properties are animated, with key times', 'op' in t.get('animated',{}), t.get('animated'))
        check('…children follow their group', [l['name'] for l in sc['layers']].index('Sun')>[l['name'] for l in sc['layers']].index('Sunrise'))
        d=(await run('get_layer',{'id':sun}))['result']
        check('get_layer gives geometry, base values and tracks', 'geometry' in d and 'base' in d and isinstance(d['tracks'],dict), list(d.keys()))
        pr=(await run('list_presets',{'group':'enter'}))['result']
        check('list_presets gives the entrances', any(x['id']=='fade-in' for x in pr), len(pr))

        # a request: everything below is one undo step
        await ev("window.req=rq.beginRequest()")
        r=await run('add_shape',{'kind':'rect','name':'Box','x':40,'y':40,'w':80,'h':60,'fill':'#ff8800'})
        box=r['result']['id']
        check('add_shape makes a rect with a box', r['ok'] and r['result']['box']==[40,40,80,60], r)
        r=await run('add_shape',{'kind':'star','name':'Twinkle','cx':500,'cy':80,'r':30,'n':6,'inner':0.5})
        star=r['result']['id']
        check('…and a star that keeps its settings', await ev(f"st.layerById('{star}').shape.n")==6, r)
        r=await run('add_shape',{'kind':'text','x':20,'y':380,'text':'Lift off','size':24})
        check('…and text', r['ok'] and await ev(f"st.layerById('{r['result']['id']}').geo.text")=='Lift off', r)
        r=await run('update_layer',{'id':box,'values':{'op':0.5,'rot':15},'geometry':{'w':100},'name':'Crate'})
        check('update_layer sets base values, geometry and the name', r['ok'] and await ev(f"[st.layerById('{box}').b.op, st.layerById('{box}').b.rot, st.layerById('{box}').geo.w, st.layerById('{box}').name]")==[0.5,15,100,'Crate'], r)
        r=await run('set_keyframes',{'id':box,'prop':'pos','keys':[{'t':0,'v':[0,0]},{'t':1,'v':[200,0],'ease':'outBack'}]})
        check('set_keyframes writes a track', r['ok'] and r['result']['keys']==2 and await ev(f"st.layerById('{box}').t.pos[0][2]")=='linear', r)
        r=await run('set_keyframes',{'id':box,'prop':'rot','keys':[{'t':0,'v':0,'ease':'easeIn'},{'t':0.5,'v':10,'ease':'power2.out'},{'t':1,'v':0}]})
        check('…easing names from CSS / Penner / GSAP are understood (easeIn, power2.out)', r['ok'] and await ev(f"st.layerById('{box}').t.rot.map(k=>k[2]).join()")=='in,outCubic,linear', r)
        r=await run('set_keyframes',{'id':box,'prop':'op','keys':[{'t':0,'v':0,'ease':'cubic-bezier(0.2, 0, 0.4, 1)'},{'t':0.5,'v':1,'ease':[0.1,0.7,0.3,1]},{'t':1,'v':0.5}]})
        g=(await run('get_layer',{'id':box}))['result']
        check('…custom curves go in as cubic-bezier() or [x1, y1, x2, y2], and get_layer reads them back', r['ok'] and [k[2] for k in g['tracks']['op']][:2]==[[0.2,0,0.4,1],[0.1,0.7,0.3,1]], (r, g['tracks'].get('op')))
        await ev("hi.setTime(0.5)")
        r=await run('update_layer',{'id':box,'values':{'pos':[100,50]}})
        check('…then a value on an animated property becomes a key at the playhead', r['result']['keyed']==['pos'] and await ev(f"st.layerById('{box}').t.pos.length")==3, r)
        r=await run('set_keyframes',{'id':box,'prop':'op','keys':[{'t':4,'v':1}]})
        check('a key past the end grows the length', r['result']['grew'] and await ev("st.doc.dur")==4, r)
        r=await run('apply_preset',{'preset':'pulse','ids':[box,star],'at':1,'stagger':0.2})
        check('apply_preset goes on both, staggered', r['ok'] and r['result']['layers']==['Crate','Twinkle'] and abs(await ev(f"st.layerById('{star}').t.scl[0][0]")-1.2)<1e-6, r)
        r=await run('group',{'ids':[box,star],'name':'Pack'})
        pack=r['result']['id']
        check('group puts them in a named group', r['ok'] and await ev(f"st.layerById('{box}').parent")==pack, r)
        r=await run('duplicate',{'id':star,'name':'Twinkle 2'})
        dup=r['result']['id']
        check('duplicate copies it', r['ok'] and await ev(f"st.layerById('{dup}').parent")==pack, r)
        r=await run('reorder',{'id':pack,'to':'front'})
        check('reorder brings the group to the front', r['ok'] and r['result']['order'][-1]=='Pack', r['result'])
        r=await run('offset_animation',{'ids':[box],'by':0.5})
        check('offset_animation moves every key', r['ok'] and await ev(f"st.layerById('{box}').t.pos[0][0]")==0.5, r)
        r=await run('clear_animation',{'id':star,'props':['scl']})
        check('clear_animation removes a track', r['ok'] and not await ev(f"!!st.layerById('{star}').t.scl"), r)
        r=await run('import_svg',{'name':'Smoke','x':320,'y':300,'svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" onload="window.hacked=1"><script>window.hacked=2</script><circle id="Puff 1" cx="20" cy="20" r="15" fill="#ccc"/><circle id="Puff 2" cx="60" cy="20" r="18" fill="#ddd"/></svg>'})
        check('import_svg brings the parts in as layers under one group', r['ok'] and len(r['result']['ids'])==1 and r['result']['layers']>=3, r)
        check('…with scripts and handlers removed', not await ev("!!window.hacked"))
        r=await run('set_document',{'length':5,'background':'#102030'})
        check('set_document sets the length and background', r['ok'] and await ev("[st.doc.dur, st.doc.bg]")==[5,'#102030'], r)
        r=await run('delete',{'ids':[dup]},"{confirmDelete: async n => { window.asked=n; return false; }}")
        check('delete asks first and keeps them on No', r['result'].get('cancelled') and await ev("window.asked")==['Twinkle 2'] and await ev(f"!!st.layerById('{dup}')"), r)
        r=await run('delete',{'ids':[dup]},"{confirmDelete: async () => true}")
        check('…and deletes on Yes', r['result']['deleted']==['Twinkle 2'] and not await ev(f"!!st.layerById('{dup}')"), r)

        # refusals change nothing
        r=await run('update_layer',{'id':title,'locked':True})
        r2=await run('set_keyframes',{'id':title,'prop':'rot','keys':[{'t':0,'v':10}]})
        check('a locked layer is refused, with a way out', not r2['ok'] and 'locked' in r2['error'], r2)
        r3=await run('update_layer',{'id':title,'locked':False,'name':'Title'})
        check('…unlocking it works', r3['ok'] and not await ev(f"st.layerById('{title}').lock"), r3)
        r=await run('update_layer',{'id':box,'values':{'pos':5}})
        check('a wrong kind of value is refused', not r['ok'] and '[x, y]' in r['error'], r)
        r=await run('set_keyframes',{'id':box,'prop':'d','keys':[{'t':0,'v':1}]})
        check('Morph on a rectangle takes path data only', not r['ok'] and 'SVG path data' in r['error'], r)
        r=await run('set_keyframes',{'id':box,'prop':'pos','keys':[{'t':0,'v':[1,1],'ease':'wobbly'}]})
        check('an unknown easing is refused', not r['ok'] and 'Unknown easing' in r['error'], r)
        r=await run('apply_preset',{'preset':'nope','ids':[box],'at':0})
        check('an unknown preset is refused', not r['ok'] and 'list_presets' in r['error'], r)

        changed=await ev("rq.endRequest(req)")
        check('the request changed the document', changed)
        check('…and is exactly one undo step', await ev("st.S.undo.length")==u0+1, (u0, await ev("st.S.undo.length")))
        check('…the latest one', await ev("rq.isLatest(req)"))
        await ev("hi.undo()"); await pg.wait_for_timeout(150)
        check('one undo takes the whole request back', await ev("st.doc.layers.length")==n0 and not await ev("st.doc.layers.some(l=>l.name==='Crate')") and await ev("st.doc.dur")==3)
        await ev("hi.redo()"); await pg.wait_for_timeout(150)
        check('redo brings it all back', await ev("st.doc.layers.some(l=>l.name==='Crate')") and await ev("st.doc.dur")==5)
        await ev("window.req2=rq.beginRequest()")
        await run('get_scene',{}); await run('select',{'ids':[title]})
        check('a request that only reads adds no undo step', not await ev("rq.endRequest(req2)") and await ev("st.S.undo.length")==u0+1)
        # Morph keys as SVG path data (a rectangle becomes a plain path; the keys get matching nodes)
        await ev("window.req3=rq.beginRequest()")
        r=await run('add_shape',{'kind':'rect','name':'Blobby','x':40,'y':300,'w':100,'h':60})
        bid=r['result']['id']
        g=(await run('get_layer',{'id':bid}))['result']
        check('get_layer gives a rectangle’s shape as path data', g.get('path',{}).get('d','').startswith('M'), g.get('path'))
        r=await run('set_keyframes',{'id':bid,'prop':'d','keys':[{'t':0,'v':g['path']['d']},{'t':1,'v':'M40 330 C60 280 120 280 140 330 C120 380 60 380 40 330 Z','ease':'inOut'}]})
        info=await ev(f"(()=>{{const l=st.doc.layers.find(x=>x.id==='{bid}');return {{type:l.type,keys:l.t.d.map(q=>q[0]),nodes:l.t.d.map(q=>q[1][0].n.length)}}}})()")
        check('set_keyframes writes Morph keys from SVG path data', r['ok'] and info['type']=='path' and info['keys']==[0,1] and info['nodes'][0]==info['nodes'][1], (r, info))
        mid=await ev(f"K.H.dstr(K.H.comp(st.doc.layers.find(x=>x.id==='{bid}'),0.5).d)")
        check('…and the shape blends between them', isinstance(mid,str) and mid.startswith('M'), mid)
        r=await run('set_keyframes',{'id':bid,'prop':'d','keys':[{'t':2,'v':'not a path'}]})
        check('…path data that can’t be read is refused with an example', not r['ok'] and 'SVG path data' in r['error'], r)
        r=await run('update_layer',{'id':title,'values':{'d':'M0 0 L10 10'}})
        check('…and text has no Morph', not r['ok'], r)
        await ev("rq.endRequest(req3)")

        await pg.screenshot(path=OUT+'agent-tools.png')
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R,indent=1)); print('FAILS',F)
        await b.close()
asyncio.run(main())
