// Measures (not estimates) rendering and query performance in real Chrome on this machine.
import { chromium } from 'playwright-core';
import os from 'node:os';

const URL_ = process.env.PULSE_URL || 'http://localhost:5185/';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(URL_, { waitUntil: 'load' });
await page.waitForFunction(() => window.__pulse?.getState().loaded, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const out = { machine: `${os.cpus()[0].model}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB, ${os.platform()} ${os.release()}`, chrome: browser.version(), viewport: '1440x900 @2x DPR, headless' };

out.genMs = await page.evaluate(() => window.__pulse.getState().loadMs);
out.pointsPerSeries = await page.evaluate(() => window.__pulse.data.count);
out.logRows = await page.evaluate(() => window.__pulse.data.logCount);

// ---- 1. decimation microbenchmark on a real 100,800-point series
out.decimation = await page.evaluate(async () => {
  const m = await import('/src/engine/downsample.ts');
  const d = window.__pulse.data;
  const arr = d.series[2 * 8 + 2];
  const dec = m.createDecimated(4096);
  const times = [];
  for (let k = 0; k < 300; k++) {
    const t0 = performance.now();
    m.minMaxBucket(arr, 0, d.count, 1200, dec);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return { points: d.count, buckets: 1200, outputPoints: dec.length, medianMs: times[150], p95Ms: times[285] };
});

// ---- 2. scripted interaction over the full 28h range (all 7 charts x up to 8 series)
await page.evaluate(() => {
  const s = window.__pulse.getState();
  const d = window.__pulse.data;
  window.__pulse.setState({ live: false, from: d.t0, to: d.latestT() });
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  window.__rafDeltas = [];
  let last = performance.now();
  const loop = (t) => { window.__rafDeltas.push(t - last); last = t; window.__raf = requestAnimationFrame(loop); };
  window.__raf = requestAnimationFrame(loop);
  const f = window.__pulseFrames; f.flushes = 0; f.flushMs.fill(0);
  window.__ptsMax = 0;
  window.__ptsTimer = setInterval(() => { window.__ptsMax = Math.max(window.__ptsMax, f.pointsLastFrame); }, 8);
});
const box = await page.locator('[data-chart="Latency p95"] canvas.lc-over').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
// wheel zoom in and out around the cursor
for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(16); }
for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(16); }
// shift-drag pan back and forth
await page.keyboard.down('Shift');
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 0; i < 120; i++) { await page.mouse.move(cx + Math.sin(i / 8) * 220, cy); await page.waitForTimeout(8); }
await page.mouse.up();
await page.keyboard.up('Shift');
// crosshair sweep (synchronised across charts)
for (let i = 0; i < 200; i++) { await page.mouse.move(box.x + 60 + ((i * 7) % (box.width - 80)), cy); await page.waitForTimeout(8); }
const res = await page.evaluate(() => {
  cancelAnimationFrame(window.__raf); clearInterval(window.__ptsTimer);
  const f = window.__pulseFrames;
  const n = Math.min(f.flushes, 1200);
  const flush = Array.from(f.flushMs.slice(0, n));
  return { rafDeltas: window.__rafDeltas.slice(5), flush, ptsMax: window.__ptsMax, charts: f.chartsLastFrame };
});
const d = res.rafDeltas;
out.interaction = {
  script: '60 wheel-zoom in + 60 out (cursor anchored), 120-step shift-drag pan, 200-step crosshair sweep, full 28h range (100,800 pts/series), 7 charts visible',
  rafFrames: d.length,
  frameIntervalMs: { median: +pct(d, 0.5).toFixed(2), p95: +pct(d, 0.95).toFixed(2), p99: +pct(d, 0.99).toFixed(2), max: +Math.max(...d).toFixed(2) },
  framesOver20ms: d.filter((x) => x > 20).length,
  drawFlushMs: { count: res.flush.length, median: +pct(res.flush, 0.5).toFixed(2), p95: +pct(res.flush, 0.95).toFixed(2), max: +Math.max(...res.flush).toFixed(2) },
  maxDecimatedPointsDrawnInOneFrame: res.ptsMax,
};
out.rawPointsInFullRangeAcrossCharts = await page.evaluate(() => 0);

// ---- 3. log query timings over the real 240k-row store
await page.evaluate(() => {
  const d = window.__pulse.data;
  window.__pulse.setState({ tab: 'logs', live: false, from: d.t0, to: d.latestT(), chips: [], q: '' });
});
await page.waitForSelector('#log-query');
const queries = [
  'level:error',
  'service:checkout level:error latency>500',
  'service:checkout level:error latency>500 "timeout" AND NOT region:eu',
  '"timeout" OR "deadline"',
  'status>=500 AND NOT (region:eu OR region:ap)',
  'latency>900 host:checkout-*',
];
const results = [];
for (const q of queries) {
  const runs = [];
  for (let r = 0; r < 12; r++) {
    const qq = r % 2 ? q + ' ' : q; // force a distinct key each time
    const wall = await page.evaluate(async (qq) => {
      const t0 = performance.now();
      window.__pulse.setState({ q: qq });
      await new Promise((res) => { const iv = setInterval(() => { const lv = window.__pulse.getState().logView; if (lv && lv.q === qq) { clearInterval(iv); res(); } }, 1); });
      const lv = window.__pulse.getState().logView;
      return { wall: performance.now() - t0, worker: lv.res.ms, scanned: lv.res.scanned, matched: lv.res.matched };
    }, qq);
    runs.push(wall);
  }
  const w = runs.map((x) => x.worker), t = runs.map((x) => x.wall);
  results.push({ q, scanned: runs[0].scanned, matched: runs[0].matched, workerMs: { median: +pct(w, 0.5).toFixed(2), max: +Math.max(...w).toFixed(2) }, roundTripMsMedian: +pct(t, 0.5).toFixed(1) });
}
out.queries = results;
console.log(JSON.stringify(out, null, 2));
await browser.close();
