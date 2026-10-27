import asyncio, sys, json, os, base64, io, zipfile
from playwright.async_api import async_playwright
OUT=os.environ.get('CIN_OUT','/tmp/svgcinema-shots/'); os.makedirs(OUT, exist_ok=True)
# Your AI assistant (agent/assist + the Agent panel): first open's choice, how to connect, window.svgcinema
# (a session is one undo step, editing paused meanwhile, Stop, Undo), images handed over as data, the drop
# card for images an assistant can't hand over, the panel's delete confirmation, the Images choice and
# its link to the API key's image model, Let assistants edit off, the Claude skill and the guide.
def _png():
    import zlib, struct
    def ch(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + b'\xff\x88\x00\xff' * 4 for _ in range(4))
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', 4, 4, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b'')
PNG=base64.b64encode(_png()).decode()
SVG='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30"><rect id="flame" width="60" height="30" fill="#f80"/></svg>'
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport={'width':1440,'height':900}, accept_downloads=True)
        await ctx.grant_permissions(['clipboard-read','clipboard-write'])
        pg=await ctx.new_page(); pg.set_default_timeout(8000)
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
        await pg.route('**/openrouter.ai/**', lambda r: r.fulfill(status=404, body=''))
        await pg.goto((sys.argv[1] if len(sys.argv)>1 else 'http://localhost:5199/')); await pg.wait_for_timeout(2500)
        await pg.evaluate("async()=>{ window.st=await import('/src/core/state.ts'); window.hi=await import('/src/core/history.ts'); window.AS=await import('/src/agent/assist.ts')}")
        E=pg.evaluate; R={}; F=[]
        def check(n,c,i=None):
            R[n]=('ok' if c else 'FAIL')+('' if i is None else f' {i}')
            if not c: F.append(n)
        txt=lambda sel: E(f"(document.querySelector({json.dumps(sel)})||{{}}).textContent||''")
        has=lambda sel: E(f"!!document.querySelector({json.dumps(sel)})")

        check('window.svgcinema is there, with help() as plain text', await E("typeof svgcinema.help()==='string' && svgcinema.help().includes('svgcinema.start(')"))
        await pg.click('#bAgent'); await pg.wait_for_timeout(250)
        check('first open: Your AI assistant is picked', await E("document.querySelector('input[name=agWay]:checked').value")=='assistant')
        await pg.click('[data-act=way]'); await pg.wait_for_timeout(200)
        check('Continue shows how to connect, with the header chip', await has('.ag-connect') and 'Your AI assistant' in await txt('.ag-mode'))
        check('the starting message tells it to run help()', 'window.svgcinema.help()' in await txt('.ag-msg-t'))
        await pg.click('[data-act=copystart]'); await pg.wait_for_timeout(150)
        check('Copy puts the starting message on the clipboard', 'svgcinema.help()' in await E("navigator.clipboard.readText()"))
        check('Images: your assistant’s own; the image key needs an image model first', await E("[...document.querySelectorAll('#agAsImg option')].map(o=>o.value+(o.disabled?'-':'')).join()")=='own,key-,vector')
        await pg.screenshot(path=OUT+'assist-connect.png', clip={'x':1100,'y':52,'width':340,'height':848})

        # a session through window.svgcinema
        await E("svgcinema.start({task:'Add a flame', assistant:'Claude in Chrome'})")
        await pg.wait_for_timeout(150)
        check('a session pauses editing and shows its assistant', await E("document.querySelector('#app').classList.contains('agent-busy')") and 'Claude in Chrome' in await txt('.ag-who'))
        n0=await E("st.doc.layers.length")
        r=await E(f"svgcinema.batch([{{name:'get_scene'}},{{name:'import_svg',args:{{name:'Flame',svg:{json.dumps(SVG)}}}}},{{name:'add_image',args:{{name:'Dot',data:'data:image/png;base64,{PNG}',x:100,y:100,width:40}}}}])")
        check('batch runs the tools in order', r[0]['canvas']['w']>0 and not r[1].get('error') and not r[2].get('error'), r[1:])
        check('add_image places a picture handed over as data', await E("st.doc.layers.some(l=>l.type==='image'&&l.name==='Dot')") and r[2].get('from')=='data')
        await pg.wait_for_timeout(150)
        check('the panel shows Working with each step', 'Working · 3 steps so far' in await txt('.ag-steps-h') and await E("document.querySelectorAll('.ag-steps .ag-step').length")==3)
        check('…and Stop and Undo below', await has('[data-act=asstop]') and await has('[data-act=asundo]') and 'Connected' in await txt('.ag-as-st'))
        await pg.screenshot(path=OUT+'assist-working.png', clip={'x':1100,'y':52,'width':340,'height':848})

        # an image it can't hand over: the drop card
        q=await E("svgcinema.call('request_image',{name:'Rocket',model:'Nano Banana'})")
        await pg.wait_for_timeout(150)
        check('request_image shows the drop card', await has('#agDrop') and 'Rocket' in await txt('.ag-dropcard') and 'Waiting for your image' in await txt('.ag-as-st'))
        await pg.screenshot(path=OUT+'assist-drop.png', clip={'x':1100,'y':52,'width':340,'height':848})
        wait=asyncio.ensure_future(pg.evaluate(f"svgcinema.call('wait_image',{{id:{json.dumps(q['id'])}}})"))
        await pg.set_input_files('#agDropFile', files=[{'name':'rocket.png','mimeType':'image/png','buffer':base64.b64decode(PNG)}])
        w=await wait
        check('choosing the file answers wait_image with the asset', bool(w.get('asset')) and w.get('name')=='Rocket', w)
        await pg.wait_for_timeout(150)
        check('…and the drop card goes', not await has('#agDrop'))
        p2=await E(f"svgcinema.call('place_image',{{asset:{json.dumps(w.get('asset',''))}}})")
        check('the assistant places it', bool(p2.get('id')), p2)

        # Ask first: deleting asks in the panel
        did=await E("st.doc.layers.find(l=>l.name==='Dot').id")
        dp=asyncio.ensure_future(pg.evaluate(f"svgcinema.call('delete',{{ids:[{json.dumps(did)}]}})"))
        await pg.wait_for_timeout(250)
        check('a delete asks in the panel', await has('.ag-confirm [data-act=keep]'))
        await pg.click('.ag-confirm [data-act=keep]')
        d=await dp
        check('Keep refuses the delete', d.get('cancelled')==True and await E("st.doc.layers.some(l=>l.name==='Dot')"), d)

        out=await E("svgcinema.done('Added a flame and a rocket')")
        check('done() closes it: editing comes back, one undo step', not await E("document.querySelector('#app').classList.contains('agent-busy')") and out['changed'], out)
        await pg.wait_for_timeout(150)
        check('the closed session reads its summary, with Undo and How to connect', 'Added a flame and a rocket' in await txt('.ag-as') and await has('[data-act=asundo]') and await has('[data-act=howto]'))
        await pg.click('[data-act=asundo]'); await pg.wait_for_timeout(150)
        check('Undo takes the whole session back', await E("st.doc.layers.length")==n0 and not await has('[data-act=asundo]'))

        # Stop
        await E("svgcinema.start({task:'More', assistant:'Claude in Chrome'})")
        await E("svgcinema.call('add_shape',{kind:'rect',name:'Box',x:10,y:10,w:30,h:30})")
        await pg.wait_for_timeout(100)
        await pg.click('[data-act=asstop]'); await pg.wait_for_timeout(150)
        st=await E("svgcinema.call('get_scene')")
        check('after Stop the next call is refused, the work kept', 'pressed Stop' in (st.get('error') or '') and await E("st.doc.layers.some(l=>l.name==='Box')"))
        check('…and a new start() works again', not (await E("(svgcinema.start('x'), svgcinema.call('get_scene'))")).get('error'))
        await E("svgcinema.done()")
        # an earlier session folds to one line
        await pg.wait_for_timeout(100)
        check('earlier sessions fold to one line', await E("document.querySelectorAll('.ag-past').length")>=1)

        # Settings
        await pg.click('#agent [data-act=settings]'); await pg.wait_for_timeout(200)
        check('Settings: How you connect, then Your AI assistant', await E("[...document.querySelectorAll('.ag-sec h3')].map(h=>h.textContent.trim()).slice(0,4).join('|')")=='How you connect|Your AI assistant|Ask first|Privacy')
        check('…the image key is greyed out, with a link to set one up', await E("document.querySelector('input[name=agAsImgR][value=key]').disabled") and await has('.ag-inone [data-act=peekimg]'))
        check('…Last used by the last assistant', 'Last used by Your assistant' in await txt('.ag-last'), await txt('.ag-last'))
        await pg.screenshot(path=OUT+'assist-settings.png', clip={'x':1100,'y':52,'width':340,'height':848})
        await pg.click('.ag-inone [data-act=peekimg]'); await pg.wait_for_timeout(150)
        check('the link opens the API key’s image settings, still using the assistant', await has('#agImgProv') and await E("document.querySelector('.ag-seg [aria-checked=true]').dataset.v")=='assistant')
        await pg.click('[data-act=peekback]'); await pg.wait_for_timeout(100)
        # an image model set up: the image key is offered, with what it uses
        await E("localStorage.setItem('svgcinema:agent.keys', JSON.stringify({openrouter:'test-key'}))")
        await pg.click('[data-act=peekimg]'); await pg.click('[data-act=peekback]'); await pg.wait_for_timeout(100)
        check('with an image model the image key shows it, with Change', not await E("document.querySelector('input[name=agAsImgR][value=key]').disabled") and 'OpenRouter' in await txt('.ag-icfg'))
        await pg.click('input[name=agAsImgR][value=key]'); await pg.wait_for_timeout(100)
        check('…picking it offers generate_image to assistants, and Ask first before images', 'generate_image' in await E("svgcinema.tools().map(t=>t.name)") and await has('[data-act=askimg]'))
        await pg.click('input[name=agAsImgR][value=vector]'); await pg.wait_for_timeout(100)
        tn=await E("svgcinema.tools().map(t=>t.name)")
        check('Vector shapes only: no image tools', not any(n in tn for n in ['generate_image','add_image']), tn)
        await pg.click('.ag-sec [data-act=assiston]'); await pg.wait_for_timeout(100)
        check('Let assistants edit off refuses every call', 'turned off' in ((await E("svgcinema.call('get_scene')")).get('error') or ''))
        await pg.click('.ag-sec [data-act=assiston]')

        # the skill and the guide
        async with pg.expect_download() as dl:
            await pg.click('.ag-start [data-act=skill]')
        z=zipfile.ZipFile(io.BytesIO(open(await (await dl.value).path(),'rb').read()))
        md=z.read('svgcinema/SKILL.md').decode()
        check('the Claude skill is a folder with SKILL.md pointing at help()', md.startswith('---\nname: svgcinema') and 'svgcinema.help()' in md)
        async with ctx.expect_page() as pp:
            await pg.click('.ag-start [data-act=guide]')
        gp=await pp.value; await gp.wait_for_load_state()
        check('the guide opens as plain text', 'guide for AI assistants' in (await gp.text_content('body') or ''))
        await gp.close()

        # How you connect: back to an API key
        await pg.click('.ag-seg [data-v=key]'); await pg.wait_for_timeout(100)
        check('switching to API key shows its settings', await has('#agProv') and await E("JSON.parse(localStorage.getItem('svgcinema:agent.settings')).connect")=='key')
        check('no page errors', not errs, errs[:3])
        print(json.dumps(R,indent=1)); print('FAILS',F)
        await b.close()
asyncio.run(main())
