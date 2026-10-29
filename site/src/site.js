(function () {
  var d = document,
    root = d.documentElement;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.classList.add('boot');

  /* ---------- theme (shares the editor's key) ---------- */
  function curTheme() {
    var t = root.dataset.theme;
    if (t === 'light' || t === 'dark') return t;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  d.getElementById('themeBtn').addEventListener('click', function () {
    var t = curTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = t;
    try {
      localStorage.setItem('svgcinema:theme', t);
    } catch (e) {}
  });

  var hooks = [];
  function fmt(t) {
    var s = Math.floor(t),
      c = Math.floor((t - s) * 100);
    return '0:' + (s < 10 ? '0' : '') + s + '.' + (c < 10 ? '0' : '') + c;
  }

  /* ---------- scroll playhead in the header ---------- */
  var top = d.querySelector('.top'),
    ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var max = d.documentElement.scrollHeight - innerHeight;
      top.style.setProperty('--p', max > 0 ? Math.min(1, scrollY / max) : 0);
      hooks.forEach(function (h) {
        h();
      });
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);

  /* ---------- hero: the real exported scene and its timeline ---------- */
  if (d.getElementById('app'))
    (function () {
      var DUR = 3;
      var TRACKS = [
        ['Sky', 'Fill', [0, 2.2]],
        ['Sunrise', 'Position', [0, 1.2]],
        ['Rays', 'Rotate', [0, 3], 1],
        ['Blob', 'Shape', [0, 1.1, 2.1, 3]],
        ['Comet', 'Position', [0, 1, 2, 3]],
        ['Horizon', 'Trim end', [0.2, 1.8], 1],
        ['Stem', 'Bone rotate', [1.2, 1.9, 2.6, 3]],
        ['Flag', 'Pin 2', [1.2, 1.8, 2.4, 3], 1],
        ['Title', 'Opacity', [1, 1.8]],
      ];
      var names = d.getElementById('tlNames'),
        rows = d.getElementById('tlRows'),
        ruler = d.getElementById('tlRuler');
      var rowEls = [],
        dms = [];
      function pc(t) {
        return (t / DUR) * 100 + '%';
      }
      (function buildRuler(el, n, label) {
        for (var i = 0; i <= n * 2; i++) {
          var s = d.createElement('span');
          var t = i / 2;
          if (i % 2) s.className = 'mid';
          else s.textContent = label(t);
          s.style.left = (i / (n * 2)) * 100 + '%';
          if (i === n * 2) {
            s.style.left = 'auto';
            s.style.right = '0';
            s.textContent = '';
          }
          el.appendChild(s);
        }
      })(ruler, 3, function (t) {
        return t ? t + 's' : '';
      });
      TRACKS.forEach(function (tr) {
        var n = d.createElement('div');
        if (tr[3]) n.className = 'opt';
        n.innerHTML = '<span class="nm"></span><span class="pr"></span>';
        n.firstChild.textContent = tr[0];
        n.lastChild.textContent = tr[1].toUpperCase();
        names.appendChild(n);
        var r = d.createElement('div');
        r.className = 'tl-row' + (tr[3] ? ' opt' : '');
        var k = tr[2];
        for (var i = 0; i < k.length - 1; i++) {
          var s = d.createElement('div');
          s.className = 'seg';
          s.style.left = pc(k[i]);
          s.style.width = ((k[i + 1] - k[i]) / DUR) * 100 + '%';
          r.appendChild(s);
        }
        k.forEach(function (t) {
          var m = d.createElement('i');
          m.className = 'dm';
          m.style.left = pc(t);
          r.appendChild(m);
          dms.push([m, t]);
        });
        rows.appendChild(r);
        rowEls.push([r, k[0], k[k.length - 1]]);
      });

      var app = d.getElementById('app'),
        area = d.getElementById('tlArea'),
        head = d.getElementById('tlHead'),
        flag = d.getElementById('tlFlag'),
        read = d.getElementById('timeRead');
      var svg = d.getElementById('hero-svg'),
        P = svg && svg.player;
      var lastT = -1,
        scrubbing = false,
        wasPlaying = true,
        heroVisible = true;
      function cur() {
        if (!P) return 0;
        var ms = P.currentTime || 0,
          du = P.duration || 3000;
        return (((ms % du) + du) % du) / 1000;
      }
      function paint(t) {
        if (Math.abs(t - lastT) < 0.004) return;
        lastT = t;
        head.style.setProperty('--x', (t / DUR) * area.clientWidth + 'px');
        flag.textContent = t.toFixed(2) + 's';
        read.firstChild.nodeValue = fmt(t) + ' ';
        area.setAttribute('aria-valuenow', t.toFixed(2));
        for (var i = 0; i < dms.length; i++) dms[i][0].classList.toggle('hit', Math.abs(dms[i][1] - t) < 0.06);
        for (var j = 0; j < rowEls.length; j++)
          rowEls[j][0].classList.toggle('live', t >= rowEls[j][1] && t <= rowEls[j][2]);
      }
      function syncPlayState() {
        app.classList.toggle('playing', !!(P && P.isPlaying));
        d.getElementById('playBtn').setAttribute('aria-label', P && P.isPlaying ? 'Pause' : 'Play');
      }
      function loop() {
        if (heroVisible || scrubbing) paint(cur());
        requestAnimationFrame(loop);
      }
      if (P) {
        if (reduce) {
          P.pause();
          P.seekTo(2400);
        }
        syncPlayState();
        requestAnimationFrame(loop);
        d.getElementById('playBtn').addEventListener('click', function () {
          if (P.isPlaying) P.pause();
          else P.play();
          syncPlayState();
        });
        function seekX(x) {
          var r = area.getBoundingClientRect();
          var f = Math.max(0, Math.min(0.999, (x - r.left) / r.width));
          P.seekTo(f * DUR * 1000);
          lastT = -1;
          paint(f * DUR);
        }
        area.addEventListener('pointerdown', function (e) {
          scrubbing = true;
          wasPlaying = P.isPlaying;
          P.pause();
          syncPlayState();
          seekX(e.clientX);
          area.setPointerCapture(e.pointerId);
        });
        area.addEventListener('pointermove', function (e) {
          if (scrubbing) seekX(e.clientX);
        });
        function end() {
          if (!scrubbing) return;
          scrubbing = false;
          if (wasPlaying) P.play();
          syncPlayState();
        }
        area.addEventListener('pointerup', end);
        area.addEventListener('pointercancel', end);
        area.addEventListener('keydown', function (e) {
          var step = e.shiftKey ? 500 : 100;
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            P.pause();
            syncPlayState();
            var t = cur() * 1000 + (e.key === 'ArrowRight' ? step : -step);
            P.seekTo(Math.max(0, Math.min(2999, t)));
          } else if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (P.isPlaying) P.pause();
            else P.play();
            syncPlayState();
          }
        });
        if ('IntersectionObserver' in window)
          new IntersectionObserver(
            function (en) {
              heroVisible = en[0].isIntersecting;
              if (!heroVisible && P.isPlaying) {
                P.pause();
                app.dataset.autopaused = '1';
              } else if (heroVisible && app.dataset.autopaused) {
                delete app.dataset.autopaused;
                P.play();
              }
              syncPlayState();
            },
            { threshold: 0.05 },
          ).observe(app);
      }
    })();

  /* ---------- specimens: run only while visible ---------- */
  var specs = d.querySelectorAll('.spec, .final');
  function setRun(el, on) {
    el.classList.toggle('inview', on);
    var s = el.querySelector('svg');
    if (s && s.pauseAnimations) {
      if (on && !reduce) s.unpauseAnimations();
      else s.pauseAnimations();
    }
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(
      function (en) {
        en.forEach(function (x) {
          setRun(x.target, x.isIntersecting);
        });
      },
      { rootMargin: '80px' },
    );
    specs.forEach(function (s) {
      io.observe(s);
    });
  } else
    specs.forEach(function (s) {
      setRun(s, true);
    });

  /* ---------- workflow: scroll scrubs the scene ---------- */
  if (d.getElementById('flow'))
    (function () {
      var flow = d.getElementById('flow'),
        fArt = d.getElementById('flowArt');
      var hill = d.getElementById('fhill'),
        ground = d.getElementById('fground'),
        nodes = d.getElementById('fnodes').children,
        pen = d.getElementById('fpen');
      var sun = d.getElementById('fsun'),
        sel = d.getElementById('fsel'),
        skyB = d.getElementById('fskyB'),
        file = d.getElementById('ffile');
      var fHead = d.getElementById('fHead'),
        fFlag = d.getElementById('fFlag'),
        ftime = d.getElementById('ftime'),
        fks = d.querySelectorAll('.fk'),
        fsegs = d.querySelectorAll('.fseg'),
        steps = d.querySelectorAll('.step');
      var hillLen = hill.getTotalLength ? hill.getTotalLength() : 340;
      (function () {
        var r = d.getElementById('fRuler');
        for (var i = 0; i <= 6; i++) {
          var s = d.createElement('span');
          if (i % 2) s.className = 'mid';
          else if (i && i < 6) s.textContent = i + 's';
          s.style.left = (i / 6) * 100 + '%';
          if (i === 6) {
            s.style.left = 'auto';
            s.style.right = '0';
          }
          r.appendChild(s);
        }
      })();
      function cl(x) {
        return x < 0 ? 0 : x > 1 ? 1 : x;
      }
      function ease(x) {
        return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
      }
      function mix(a, b, t) {
        return a + (b - a) * t;
      }
      function mixC(a, b, t) {
        var A = parseInt(a.slice(1), 16),
          B = parseInt(b.slice(1), 16);
        var r = Math.round(mix(A >> 16, B >> 16, t)),
          g = Math.round(mix((A >> 8) & 255, (B >> 8) & 255, t)),
          bl = Math.round(mix(A & 255, B & 255, t));
        return 'rgb(' + r + ',' + g + ',' + bl + ')';
      }
      function flowUpdate() {
        var c = innerHeight * 0.5,
          p = 0;
        for (var q = 0; q < steps.length; q++) {
          var sr = steps[q].getBoundingClientRect();
          if (sr.top <= c) p = (q + cl((c - sr.top) / sr.height)) / steps.length;
        }
        if (steps[0].getBoundingClientRect().top > c) p = 0;
        var e1 = ease(cl((p - 0.02) / 0.28)),
          e2 = ease(cl((p - 0.36) / 0.26)),
          e3 = ease(cl((p - 0.67) / 0.09));
        hill.style.strokeDashoffset = 1 - e1;
        for (var i = 0; i < nodes.length; i++)
          nodes[i].style.opacity = e1 >= [0, 0.46, 0.98][i] ? (e3 > 0 ? 1 - e3 : 1) : 0;
        ground.style.opacity = cl((e1 - 0.7) / 0.3);
        var pt = hill.getPointAtLength ? hill.getPointAtLength(e1 * hillLen) : { x: 0, y: 0 };
        pen.setAttribute('transform', 'translate(' + pt.x + ' ' + pt.y + ')');
        pen.style.opacity = e1 > 0 && e1 < 1 ? 1 : 0;
        var cy = mix(186, 96, e2);
        sun.setAttribute('cy', cy);
        sun.setAttribute('fill', mixC('#ff6b6f', '#ffc547', ease(cl((p - 0.4) / 0.24))));
        sun.style.opacity = p > 0.34 ? 1 : 0;
        sel.setAttribute('y', cy - 28);
        sel.style.opacity = e2 > 0.08 && p < 0.67 ? 1 : 0;
        skyB.setAttribute('stop-color', mixC('#14213d', '#d9787a', e2));
        file.style.setProperty('--o', 1 - e3);
        fArt.classList.toggle('out', e3 > 0.5);
        for (var k = 0; k < fks.length; k++) {
          var kt = +fks[k].dataset.k;
          fks[k].style.opacity = p + 0.001 >= kt ? 1 : 0.0;
          fks[k].classList.toggle('hit', Math.abs(p - kt) < 0.025);
        }
        for (var s = 0; s < fsegs.length; s++) fsegs[s].style.opacity = p > 0.4 ? 1 : 0;
        fHead.style.setProperty('--x', p * fHead.parentNode.clientWidth + 'px');
        var secs = p * 6;
        fFlag.textContent = secs.toFixed(2) + 's';
        ftime.textContent = fmt(secs);
        var st = p < 0.34 ? 0 : p < 0.67 ? 1 : 2;
        for (var j = 0; j < steps.length; j++) steps[j].classList.toggle('on', j === st);
      }
      hooks.push(flowUpdate);
      flowUpdate();
    })();

  /* ---------- export code tabs ---------- */
  if (d.getElementById('snips'))
    (function () {
      var SN = JSON.parse(d.getElementById('snips').textContent);
      var NOTES = {
        html: 'Put the .svg file next to your page. <code>&lt;object&gt;</code> keeps the player working. Pasting the SVG code straight into your HTML works too, but inserting it with <code>innerHTML</code> doesn’t run its script.',
        react:
          'Put the .svg in your public folder. React doesn’t run scripts inside markup set with <code>dangerouslySetInnerHTML</code>, so use <code>&lt;object&gt;</code>.',
        next: 'Put the .svg in <code>public/</code>. The component needs <code>"use client"</code> because it talks to the player in the browser.',
        vue: 'Put the .svg in <code>public/</code> (Vite or Vue CLI).',
        svelte: 'Put the .svg in <code>static/</code> (SvelteKit) or <code>public/</code>.',
        angular: 'Put the .svg in <code>src/assets/</code>, or <code>public/</code> on Angular 17 and later.',
        css: 'A CSS-only export has no script, so it works as a plain image or a background.',
        api: 'Every method returns the player, so calls can be chained. The player is also available as <code>cinPlayer</code>.',
      };
      function esc(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      function hl(src) {
        var re =
          /(\/\/[^\n]*|<!--[\s\S]*?-->)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`)|(<\/?[A-Za-z][\w.-]*|\/?>)|\b(import|from|export|default|function|const|let|var|return|new|if|class|implements|this)\b/g;
        var out = '',
          last = 0,
          m;
        while ((m = re.exec(src))) {
          out += esc(src.slice(last, m.index));
          var cls = m[1] ? 't-c' : m[2] ? 't-s' : m[3] ? 't-t' : 't-k';
          out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
          last = re.lastIndex;
        }
        return out + esc(src.slice(last));
      }
      var tabs = d.querySelectorAll('.tabs [role=tab]'),
        codeEl = d.getElementById('codeEl'),
        pre = d.getElementById('codePre'),
        note = d.getElementById('codeNote'),
        curFw = 'html';
      function show(fw) {
        curFw = fw;
        codeEl.innerHTML = hl(SN[fw] || '');
        note.innerHTML = NOTES[fw] || '';
        tabs.forEach(function (b) {
          var on = b.dataset.fw === fw;
          b.setAttribute('aria-selected', on);
          b.tabIndex = on ? 0 : -1;
          if (on) pre.setAttribute('aria-labelledby', b.id);
        });
        pre.scrollTop = 0;
      }
      tabs.forEach(function (b, i) {
        b.addEventListener('click', function () {
          show(b.dataset.fw);
        });
        b.addEventListener('keydown', function (e) {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          var n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
          n.focus();
          show(n.dataset.fw);
        });
      });
      show('html');
      var copyBtn = d.getElementById('copyBtn');
      copyBtn.addEventListener('click', function () {
        var txt = SN[curFw] || '';
        function done(msg) {
          copyBtn.textContent = msg;
          setTimeout(function () {
            copyBtn.textContent = 'Copy';
          }, 1600);
        }
        function fallback() {
          var r = d.createRange();
          r.selectNodeContents(codeEl);
          var s = getSelection();
          s.removeAllRanges();
          s.addRange(r);
          done('Selected');
        }
        try {
          navigator.clipboard.writeText(txt).then(function () {
            done('Copied');
          }, fallback);
        } catch (e) {
          fallback();
        }
      });
    })();

  /* ---------- images: a real export-dialog image panel ---------- */
  (function () {
    var panel = d.getElementById('xpanel');
    if (!panel) return;
    var SW = 2400,
      SH = 1500,
      src = null,
      origSize = 0,
      url = null,
      busy = false,
      again = false;
    var opt = d.getElementById('imgOpt'),
      fmtSel = d.getElementById('imgFmt'),
      q = d.getElementById('imgQ'),
      qv = d.getElementById('imgQv'),
      hi = d.getElementById('imgHi');
    var img = d.getElementById('xpImg'),
      loupe = d.getElementById('xpLoupe'),
      prev = d.getElementById('xpPrev');
    var outSize = d.getElementById('xpOutSize'),
      outLbl = d.getElementById('xpOut'),
      origLbl = d.getElementById('xpOrig'),
      bar = d.getElementById('xpBar'),
      note = d.getElementById('xpNote');
    var ENC = {};
    function kb(n) {
      return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    }
    function blob(cv, type, qq) {
      return new Promise(function (r) {
        try {
          cv.toBlob(
            function (b) {
              r(b);
            },
            type,
            qq,
          );
        } catch (e) {
          r(null);
        }
      });
    }
    function makePhoto() {
      var c = d.createElement('canvas');
      c.width = SW;
      c.height = SH;
      var x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, SH);
      g.addColorStop(0, '#16224a');
      g.addColorStop(0.45, '#7a4f8f');
      g.addColorStop(0.7, '#f08a6a');
      g.addColorStop(1, '#ffd08a');
      x.fillStyle = g;
      x.fillRect(0, 0, SW, SH);
      var sg = x.createRadialGradient(SW * 0.62, SH * 0.62, 0, SW * 0.62, SH * 0.62, SH * 0.55);
      sg.addColorStop(0, 'rgba(255,248,220,1)');
      sg.addColorStop(0.12, 'rgba(255,214,130,.95)');
      sg.addColorStop(1, 'rgba(255,170,110,0)');
      x.fillStyle = sg;
      x.fillRect(0, 0, SW, SH);
      for (var k = 0; k < 40; k++) {
        x.fillStyle = 'rgba(255,255,255,' + (0.03 + Math.random() * 0.05) + ')';
        x.beginPath();
        x.ellipse(
          Math.random() * SW,
          SH * (0.1 + Math.random() * 0.35),
          120 + Math.random() * 380,
          14 + Math.random() * 30,
          0,
          0,
          7,
        );
        x.fill();
      }
      var ridges = [
        ['#5b3f6e', 0.58, 90, 0.0021],
        ['#3a2c55', 0.68, 70, 0.0034],
        ['#22203d', 0.78, 55, 0.006],
        ['#141428', 0.88, 40, 0.011],
      ];
      ridges.forEach(function (rg, i) {
        x.fillStyle = rg[0];
        x.beginPath();
        x.moveTo(0, SH);
        for (var px = 0; px <= SW; px += 6) {
          var y =
            SH * rg[1] -
            rg[2] *
              (Math.sin(px * rg[3] + i * 2) + 0.5 * Math.sin(px * rg[3] * 2.7 + i) + 0.25 * Math.sin(px * rg[3] * 7.1));
          x.lineTo(px, y);
        }
        x.lineTo(SW, SH);
        x.closePath();
        x.fill();
      });
      for (var t = 0; t < 260; t++) {
        var tx = Math.random() * SW,
          th = 30 + Math.random() * 70,
          ty = SH * 0.9 + Math.random() * SH * 0.1;
        x.fillStyle = '#0d0d1c';
        x.beginPath();
        x.moveTo(tx, ty - th);
        x.lineTo(tx - th * 0.22, ty);
        x.lineTo(tx + th * 0.22, ty);
        x.fill();
      }
      var id = x.getImageData(0, 0, SW, SH),
        a = id.data;
      for (var i = 0; i < a.length; i += 4) {
        var n = (Math.random() - 0.5) * 18;
        a[i] += n;
        a[i + 1] += n;
        a[i + 2] += n;
      }
      x.putImageData(id, 0, 0);
      return c;
    }
    function scaled(w, h) {
      var cv = d.createElement('canvas');
      cv.width = w;
      cv.height = h;
      var x = cv.getContext('2d');
      x.imageSmoothingQuality = 'high';
      var s = src,
        sw = SW,
        sh = SH;
      while (sw / 2 >= w) {
        var c2 = d.createElement('canvas');
        c2.width = Math.round(sw / 2);
        c2.height = Math.round(sh / 2);
        var x2 = c2.getContext('2d');
        x2.imageSmoothingQuality = 'high';
        x2.drawImage(s, 0, 0, c2.width, c2.height);
        s = c2;
        sw = c2.width;
        sh = c2.height;
      }
      x.drawImage(s, 0, 0, w, h);
      return cv;
    }
    function name(m) {
      return (m || '').replace('image/', '').replace('jpeg', 'jpg').toUpperCase();
    }
    async function run() {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      prev.classList.add('busy');
      var on = opt.checked,
        f = fmtSel.value,
        qq = +q.value / 100;
      d.getElementById('imgFmtRow').hidden = !on;
      d.getElementById('imgHiRow').hidden = !on;
      d.getElementById('imgQRow').hidden = !on || f === 'png';
      var res;
      if (!on)
        res = {
          b: null,
          size: origSize,
          mime: 'image/png',
          w: SW,
          h: SH,
          note: 'Optimization is off, so the original is embedded.',
        };
      else {
        var w = hi.checked ? 1280 : 640,
          h = hi.checked ? 800 : 400,
          cv = scaled(w, h);
        var types =
          f === 'auto'
            ? [ENC.avif && 'image/avif', ENC.webp && 'image/webp', 'image/jpeg'].filter(Boolean)
            : ['image/' + f];
        var best = null;
        for (var i = 0; i < types.length; i++) {
          var b = await blob(cv, types[i], qq);
          if (b && b.type === types[i] && (!best || b.size < best.size)) best = b;
        }
        var nt = 'Sized for 640px wide' + (hi.checked ? ' at 2×.' : '.');
        if (!best) {
          best = await blob(cv, 'image/png');
          nt = 'This browser can’t encode ' + name('image/' + f) + ', so PNG was used. ' + nt;
        }
        if (f === 'auto') nt += ' Automatic mode tried ' + types.map(name).join(', ') + ' and kept the smallest.';
        res = { b: best, size: best.size, mime: best.type, w: w, h: h, note: nt };
      }
      if (url) URL.revokeObjectURL(url);
      url = res.b ? URL.createObjectURL(res.b) : origURL;
      img.src = url;
      loupe.style.backgroundImage = 'url(' + url + ')';
      var lw = loupe.clientWidth || 160;
      loupe.style.backgroundSize = img.clientWidth * 3 + 'px auto';
      loupe.style.backgroundPosition =
        -(img.clientWidth * 3 * 0.6 - lw / 2) + 'px ' + -(img.clientHeight * 3 * 0.58 - lw / 2) + 'px';
      outSize.textContent = kb(res.size);
      outLbl.textContent =
        res.w +
        '×' +
        res.h +
        ' ' +
        name(res.mime) +
        (on ? ', ' + Math.max(0, Math.round((1 - res.size / origSize) * 100)) + '% smaller' : '');
      bar.style.setProperty('--r', Math.max(0.015, res.size / origSize));
      note.textContent = res.note;
      prev.classList.remove('busy');
      busy = false;
      if (again) {
        again = false;
        run();
      }
    }
    var origURL = null,
      started = false;
    async function start() {
      if (started) return;
      started = true;
      src = makePhoto();
      var c = d.createElement('canvas');
      c.width = c.height = 2;
      for (var t of ['webp', 'avif']) {
        var b = await blob(c, 'image/' + t, 0.8);
        ENC[t] = !!b && b.type === 'image/' + t;
      }
      [
        ['webp', 'WebP'],
        ['avif', 'AVIF'],
      ].forEach(function (p) {
        if (!ENC[p[0]]) {
          var o = fmtSel.querySelector('[value=' + p[0] + ']');
          if (o) o.remove();
        }
      });
      var ob = await blob(src, 'image/png');
      origSize = ob ? ob.size : 6e6;
      origURL = ob ? URL.createObjectURL(ob) : '';
      origLbl.textContent = SW + '×' + SH + ' PNG, ' + kb(origSize);
      run();
    }
    var tq;
    q.addEventListener('input', function () {
      qv.textContent = q.value + '%';
      clearTimeout(tq);
      tq = setTimeout(run, 60);
    });
    [opt, fmtSel, hi].forEach(function (el) {
      el.addEventListener('change', run);
    });
    addEventListener('resize', function () {
      if (started) run();
    });
    if ('IntersectionObserver' in window) {
      var io2 = new IntersectionObserver(
        function (en) {
          if (en[0].isIntersecting) {
            io2.disconnect();
            start();
          }
        },
        { rootMargin: '400px' },
      );
      io2.observe(panel);
    } else start();
  })();

  /* ---------- keys: press them for real ---------- */
  if (d.getElementById('tools'))
    (function () {
      var keyBtns = d.querySelectorAll('.key'),
        keyOut = d.getElementById('keyOut'),
        keyMap = {};
      keyBtns.forEach(function (k) {
        keyMap[k.dataset.k] = k;
        if (k.dataset.k2) keyMap[k.dataset.k2] = k;
        k.addEventListener('click', function () {
          press(k);
        });
      });
      function press(k) {
        keyOut.innerHTML = k.dataset.tip;
        k.classList.add('down');
        clearTimeout(k._t);
        k._t = setTimeout(function () {
          k.classList.remove('down');
        }, 220);
      }
      var keysSec = d.getElementById('tools'),
        keysVisible = false;
      if ('IntersectionObserver' in window)
        new IntersectionObserver(
          function (en) {
            keysVisible = en[0].isIntersecting;
          },
          { threshold: 0.3 },
        ).observe(keysSec);
      addEventListener('keydown', function (e) {
        if (!keysVisible || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
        var tg = e.target;
        if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(tg.tagName)) && e.key === ' ')
          return;
        var k = keyMap[e.key === '_' ? '-' : e.key.toLowerCase()];
        if (!k) return;
        if (e.key === ' ') e.preventDefault();
        press(k);
      });
    })();

  /* ---------- Features: the side index follows the group in view ---------- */
  if (d.querySelector('.idx') && 'IntersectionObserver' in window)
    (function () {
      var links = d.querySelectorAll('.idx a[href^="#"]:not(.sub)'),
        seen = {};
      var io = new IntersectionObserver(
        function (en) {
          en.forEach(function (e) {
            seen[e.target.id] = e.isIntersecting;
          });
          var cur = null;
          d.querySelectorAll('.grp').forEach(function (g) {
            if (!cur && seen[g.id]) cur = g.id;
          });
          if (cur)
            links.forEach(function (a) {
              a.classList.toggle('on', a.getAttribute('href') === '#' + cur);
            });
        },
        { rootMargin: '-30% 0px -60% 0px' },
      );
      d.querySelectorAll('.grp').forEach(function (g) {
        io.observe(g);
      });
    })();

  onScroll();
})();
