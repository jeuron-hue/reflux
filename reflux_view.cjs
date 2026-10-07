// Layout checks, run in a real browser.
//
// reflux_behave.cjs drives the page under jsdom, which parses and scripts but does no
// layout: every getBoundingClientRect there is zero, so nothing it asserts can
// see a box. reflux_checks.cjs can only read the CSS text and confirm a rule was
// written, not that it produced the size it was written for. This file closes
// that gap by driving headless Chrome over the DevTools protocol and measuring
// the boxes the browser actually produced.
//
// No dependency is added for it. Node's global WebSocket speaks CDP directly and
// the browser is one already installed on the machine, so this stays inside the
// project's no-runtime-dependency rule the same way jsdom does for the others.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const FILE = process.argv[2] || 'reflux.html';
const DIR = path.dirname(path.resolve(FILE));
const url = f => 'file:///' + path.resolve(DIR, f).replace(/\\/g, '/');

let fails = [];
const chk = (c, m) => { console.log((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) fails.push(m); };

// Chrome and Edge are the same engine here; either will do. CHROME_PATH wins so
// a machine that keeps its browser somewhere else can still run this.
function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Port 0 lets the browser pick, and it writes the one it took to DevToolsActivePort
// inside the profile directory. Reading that back beats guessing a free port.
async function readEndpoint(profile, timeoutMs) {
  const f = path.join(profile, 'DevToolsActivePort');
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
    try {
      const [port, wsPath] = fs.readFileSync(f, 'utf8').split('\n');
      if (port && wsPath) return 'ws://127.0.0.1:' + port.trim() + wsPath.trim();
    } catch (e) { /* not written yet */ }
    await sleep(60);
  }
  throw new Error('browser never reported a debugging port');
}

// Minimal CDP client: one socket, one id counter, one map of pending replies.
function connect(endpoint) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    const pending = new Map();
    let nextId = 0;
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      const p = pending.get(msg.id);
      if (!p) return;                       // an event, not a reply we asked for
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.method + ': ' + msg.error.message)) : p.resolve(msg.result);
    };
    ws.onerror = () => reject(new Error('could not reach the browser on ' + endpoint));
    ws.onopen = () => resolve({
      send(method, params, sessionId) {
        const id = ++nextId;
        return new Promise((res, rej) => {
          pending.set(id, { resolve: res, reject: rej });
          ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
        });
      },
      close() { try { ws.close(); } catch (e) {} },
    });
  });
}

// A page, sized and pointed at one file. width/height drive the layout viewport;
// `touch` flips the pointer media feature so the pointer:coarse rules apply, which
// is the whole point of checking them - they are invisible to a desktop pointer.
async function open(cdp, target, { width, height, touch }) {
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: !!touch }, target);
  // pointer:coarse follows from the input devices the page believes it has, not
  // from setEmulatedMedia - that one only covers features like prefers-color-scheme.
  // Turning on touch emulation is what actually makes the coarse rules apply.
  await cdp.send('Emulation.setTouchEmulationEnabled',
    { enabled: !!touch, maxTouchPoints: 5 }, target);   // must be 1-16 even when disabling
  return async function goto(href) {
    await cdp.send('Page.navigate', { url: href }, target);
    // Rather than wait on the load event, poll for the document to be complete.
    // reflux.html pulls three CDN scripts that simply fail when the machine is
    // offline, and waiting on load would then hang until the timeout.
    for (let i = 0; i < 200; i++) {
      const r = await evaluate(cdp, target, 'document.readyState');
      if (r === 'complete' || r === 'interactive') break;
      await sleep(50);
    }
    await sleep(250);                       // let the tab's own boot script settle
  };
}

async function evaluate(cdp, target, expression) {
  const r = await cdp.send('Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true }, target);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expression.slice(0, 80));
  return r.result.value;
}

// The editor boots lazily on first activation and fits its zoom a frame later, so
// this waits for the tab to report itself ready rather than guessing at a delay.
async function measureChem(cdp, target, goto) {
  await goto(url(path.basename(FILE)) + '#chem');
  for (let i = 0; i < 60; i++) {
    if (await evaluate(cdp, target,
      '!!(window.refluxChem && window.refluxChem.isReady && window.refluxChem.isReady())')) break;
    await sleep(100);
  }
  // The engine settles its client width on its own schedule - headless took well
  // over a second - and the refit follows it. So wait for the drawn size to stop
  // moving rather than for a delay picked out of the air.
  const read = () => evaluate(cdp, target, `(() => {
    const c = document.querySelector('.K-Chem-Editor-Client');
    const ed = window.refluxChem && window.refluxChem.getEditor && window.refluxChem.getEditor();
    if (!c || !ed) return null;
    return {canvas: Math.round(c.getBoundingClientRect().width),
            client: ed.getClientDimension().width,
            zoom: +ed.getCurrZoom().toFixed(3)};
  })()`);
  let last = -1, stable = 0, m = null;
  for (let i = 0; i < 80 && stable < 3; i++) {
    m = await read();
    const w = m ? m.canvas : -1;
    stable = (w > 0 && w === last) ? stable + 1 : 0;
    last = w;
    await sleep(100);
  }
  return m;
}

(async () => {
  const bin = findBrowser();
  if (!bin) {
    console.log('FAIL  a Chrome or Edge build to measure in');
    console.log('\nNo browser found. Set CHROME_PATH to one, or install Chrome/Edge.');
    process.exit(1);
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reflux-view-'));
  const proc = spawn(bin, [
    '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking',    '--allow-file-access-from-files',
  ], { stdio: 'ignore' });

  let cdp;
  try {
    cdp = await connect(await readEndpoint(profile, 15000));
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    const TABS = ['charge', 'solution', 'ymb', 'units', 'agiscale', 'equation', 'ipcal', 'chem'];

    // ---- phone, touch pointer -------------------------------------------------
    let goto = await open(cdp, sessionId, { width: 375, height: 812, touch: true });
    await goto(url(path.basename(FILE)));

    const sizes = await evaluate(cdp, sessionId, `(() => {
      const box = s => { const e=document.querySelector(s); if(!e) return null;
        const r=e.getBoundingClientRect(); return {w:Math.round(r.width), h:Math.round(r.height)}; };
      return {coarse: matchMedia('(pointer:coarse)').matches,
              toggle: box('.theme-toggle'), tab: box('.tab-btn'),
              input: box('.field input'), footer: box('.footer a')};
    })()`);

    chk(sizes.coarse, 'browser reports a coarse pointer, so the touch rules are live');
    const big = (b, n) => chk(!!b && b.h >= 44 && b.w >= 44, n + ' is at least 44x44 (got ' +
      (b ? b.w + 'x' + b.h : 'missing') + ')');
    big(sizes.toggle, 'theme toggle');
    big(sizes.tab, 'tab button');
    big(sizes.input, 'field input');
    big(sizes.footer, 'footer link');

    // Every tab laid out at phone width without pushing the document sideways.
    // A single overflowing element makes the whole page pan, which is the most
    // common way a layout breaks on a phone and the one jsdom can never see.
    for (const t of TABS) {
      const over = await evaluate(cdp, sessionId,
        `(location.hash='#${t}', document.documentElement.scrollWidth - document.documentElement.clientWidth)`);
      chk(over <= 0, 'no sideways scroll on #' + t + ' at 375px (overflow ' + over + 'px)');
    }

    // Deep-linking to a late tab has to bring it into the scrolling bar, or the
    // page opens with no visible active state at all.
    // The bar scrolls smoothly, so the tab glides in over a few frames. Poll for
    // up to a second rather than reading the first frame, which raced the
    // animation and failed about one run in three.
    await goto(url(path.basename(FILE)) + '#ipcal');
    let deep = null;
    for (let i = 0; i < 20; i++) {
      deep = await evaluate(cdp, sessionId, `(() => {
        const a=document.querySelector('.tab-btn.active'); if(!a) return null;
        const r=a.getBoundingClientRect();
        return {text:a.textContent.trim(), left:Math.round(r.left), right:Math.round(r.right),
                visible: r.left >= -1 && r.right <= document.documentElement.clientWidth + 1};
      })()`);
      if (deep && deep.visible) break;
      await new Promise(r => setTimeout(r, 50));
    }
    chk(deep && deep.text === 'Impurity Profile', 'deep link activates the right tab');
    chk(deep && deep.visible, 'active tab is scrolled into view on a deep link (left ' +
      (deep ? deep.left : '?') + 'px)');

    // The editor draws a fixed 900x1500 sheet, and at the engine's default 1.5x
    // that rendered 1350px wide on every screen - a phone saw a fifth of it. The
    // size is computed by the engine at runtime, so this is the one layer that
    // can confirm the fit actually happened rather than that we asked for it.
    const chemPhone = await measureChem(cdp, sessionId, goto);
    chk(chemPhone && chemPhone.zoom < 1.5,
      'editor zoom fitted down from the 1.5x default at 375px (got ' +
      (chemPhone ? chemPhone.zoom : 'no editor') + ')');
    chk(chemPhone && chemPhone.canvas < 1350,
      'editor sheet is no longer 1350px wide on a phone (got ' +
      (chemPhone ? chemPhone.canvas + 'px' : '?') + ')');

    // ---- desktop --------------------------------------------------------------
    goto = await open(cdp, sessionId, { width: 1440, height: 900, touch: false });
    await goto(url(path.basename(FILE)) + '#charge');

    const fields = await evaluate(cdp, sessionId,
      `[...document.querySelectorAll('#panel-charge .field')].map(f=>Math.round(f.getBoundingClientRect().width))`);
    chk(fields.length > 0 && Math.max(...fields) <= 240,
      'no field is wider than its 240px cap at 1440px (widest ' + Math.max(...fields) + 'px)');

    // The equation field opts out of that cap through :has(). If :has() ever stops
    // matching, this is what notices - the cap would silently shrink the editor.
    await goto(url(path.basename(FILE)) + '#equation');
    const eq = await evaluate(cdp, sessionId, `(() => {
      const f=document.querySelector('#panel-equation .field:has(.eq-input)');
      return f ? Math.round(f.getBoundingClientRect().width) : null;
    })()`);
    chk(eq !== null && eq > 240, 'equation field stays exempt from the cap (got ' + eq + 'px)');

    // Even a desktop panel is narrower than the 1350px the default zoom produced,
    // so the sheet used to pan sideways here too. Fitted, it should sit flush.
    const chemDesk = await measureChem(cdp, sessionId, goto);
    // Flush, not merely "not wider": a sheet left zoomed out to phone scale would
    // satisfy a one-sided bound while wasting most of a desktop panel.
    chk(chemDesk && Math.abs(chemDesk.canvas - chemDesk.client) <= 2,
      'editor sheet fills the panel width at 1440px (' +
      (chemDesk ? chemDesk.canvas + ' vs ' + chemDesk.client : 'no editor') + ')');

    // ---- splash page ----------------------------------------------------------
    goto = await open(cdp, sessionId, { width: 375, height: 812, touch: true });
    await goto(url('index.html'));
    const splash = await evaluate(cdp, sessionId, `(() => {
      const box = s => { const e=document.querySelector(s); if(!e) return null;
        const r=e.getBoundingClientRect(); return {w:Math.round(r.width), h:Math.round(r.height)}; };
      return {overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              toggle: box('.theme-toggle'), open: box('.lede .open-all'), footer: box('.footer a'),
              cards: document.querySelectorAll('.tool').length,
              columns: getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length};
    })()`);
    chk(splash.overflow <= 0, 'splash does not scroll sideways at 375px (overflow ' + splash.overflow + 'px)');
    big(splash.toggle, 'splash theme toggle');
    big(splash.open, 'splash open-toolbox button');
    big(splash.footer, 'splash footer link');
    chk(splash.columns === 1, 'splash cards collapse to one column at 375px (got ' + splash.columns + ')');
    chk(splash.cards === TABS.length, 'splash still shows one card per tab (got ' + splash.cards + ')');

    cdp.close();
  } catch (err) {
    console.log('FAIL  the browser run completed');
    console.log('      ' + err.message);
    fails.push('browser run');
    if (cdp) cdp.close();
  } finally {
    try { proc.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n' + (fails.length ? fails.length + ' FAILURES' : 'ALL GREEN'));
  process.exit(fails.length ? 1 : 0);
})();
