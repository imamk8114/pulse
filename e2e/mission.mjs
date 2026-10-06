// End-to-end: performs the whole "Investigate the outage" mission with real mouse/keyboard input
// and asserts that every step completes from real state. Also captures the README screenshots.
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, '..', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const URL_ = process.env.PULSE_URL || 'http://localhost:5185/';
const SHOOT = process.env.NO_SHOTS ? false : true;

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark', permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failed++;
};
const shot = async (name) => SHOOT && (await page.screenshot({ path: path.join(shots, name) }));
const stepDone = (id) => page.evaluate((i) => document.querySelector(`[data-step="${i}"]`)?.getAttribute('data-done') === 'true', id);
const waitStep = async (id, label) => {
  try {
    await page.waitForFunction((i) => document.querySelector(`[data-step="${i}"]`)?.getAttribute('data-done') === 'true', id, { timeout: 15000 });
    check(`mission step: ${label}`, true);
  } catch {
    check(`mission step: ${label}`, false);
  }
};
const st = () => page.evaluate(() => {
  const s = window.__pulse.getState();
  return { culprit: window.__pulse.data.scenario.culprit, tD: window.__pulse.data.scenario.culpritDeployTs };
});

await page.goto(URL_, { waitUntil: 'load' });
await page.waitForFunction(() => window.__pulse?.getState().loaded, null, { timeout: 30000 });
await page.waitForSelector('canvas.lc-over');
await page.waitForTimeout(1200);
const { culprit, tD } = await st();
console.log('scenario culprit:', culprit);

check('first screen is alive: anomaly banner visible', await page.locator('.banner').isVisible());
check('mission panel open on first run', await page.getByTestId('mission').isVisible());
await shot('01-overview-anomaly.png');

// ---- helper: pixel x for a timestamp on a chart
const chartBox = async (title) => {
  const loc = page.locator(`[data-chart="${title}"] canvas.lc-over`);
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  return box;
};
const xFor = async (t, box) => {
  const v = await page.evaluate(() => window.__pulse.getView());
  return box.x + 46 + ((t - v.from) / (v.to - v.from)) * (box.width - 58);
};

// ---- 1. brush-zoom into the spike
let box = await chartBox('Latency p95');
let x0 = await xFor(tD - 4 * 60_000, box);
let x1 = await xFor(tD + 12 * 60_000, box);
const y = box.y + box.height / 2;
await page.mouse.move(x0, y);
await page.mouse.down();
await page.mouse.move((x0 + x1) / 2, y, { steps: 8 });
await page.mouse.move(x1, y, { steps: 8 });
await page.mouse.up();
await waitStep('zoom', 'brush-zoom into the spike');
const zoomed = await page.evaluate(() => { const s = window.__pulse.getState(); return { live: s.live, span: (s.to - s.from) / 60000 }; });
check('all linked charts follow (view paused, ~16 min span)', !zoomed.live && zoomed.span > 10 && zoomed.span < 25, `span=${zoomed.span.toFixed(1)}m`);

// synced crosshair across charts
box = await chartBox('Latency p95');
await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.45, { steps: 5 });
await page.waitForTimeout(300);
const tips = await page.locator('.chart-tip:not([hidden])').count();
check('crosshair tooltip shown on several charts at once', tips >= 3, `visible tooltips=${tips}`);
await page.evaluate(() => window.scrollTo(0, 0));
await shot('02-brushed-synced-crosshair.png');

// ---- 4 (done early since the marker is in view). Inspect the deploy marker.
box = await chartBox('Latency p95');
const mx = await xFor(tD, box);
await page.mouse.move(mx, box.y + 12);
await page.waitForTimeout(150);
await page.mouse.click(mx, box.y + 12);
await waitStep('marker', 'inspect the deploy marker');
check('deploy popover shows details', (await page.getByTestId('deploy-pop').innerText()).includes(culprit));
await shot('03-deploy-marker-popover.png');
await page.getByRole('button', { name: 'Close deploy details' }).click();

// ---- 2. Filter logs with a typed query
await page.getByRole('button', { name: 'Logs', exact: true }).click();
await page.waitForSelector('#log-query');
await page.locator('#log-query').click();
await page.keyboard.type('level:error service:ch', { delay: 25 });
await page.waitForSelector('[role="option"]');
await page.waitForTimeout(250);
await page.keyboard.press('Tab'); // accept autocomplete
await page.waitForFunction(() => document.querySelector('#log-query').value.startsWith('level:error service:checkout'));
await page.keyboard.type('latency>500 "timeout" AND NOT region:eu', { delay: 15 });
await page.waitForFunction(() => /matches of/.test(document.querySelector('[data-testid="qstat"]')?.textContent || ''), null, { timeout: 15000 });
await waitStep('filter', 'filter logs with level:error service:<culprit>');
const stat1 = await page.getByTestId('qstat').innerText();
console.log('   query stat:', stat1);
check('query reports matched count + measured ms', /\d+ matches of [\d,]+ rows scanned in [\d.]+ ms/.test(stat1));

// syntax error is shown inline with a position
await page.locator('#log-query').press('End');
await page.keyboard.type(' AND (', { delay: 10 });
await page.waitForSelector('.qerr');
check('inline parse error with position', /position \d+/.test(await page.locator('.qerr').innerText()));
for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
await page.waitForFunction(() => !document.querySelector('.qerr'));
// widen the query for a nicer histogram (still has the incident story)
await page.locator('#log-query').fill('');
await page.keyboard.type('level:error service:' + culprit, { delay: 5 });
await page.getByRole('button', { name: 'Reset time range to live' }).click();
await page.waitForFunction(() => { const m = document.querySelector('[data-testid="qstat"]')?.textContent || ''; return /matches of/.test(m) && !/^0 /.test(m); }, null, { timeout: 15000 });

// ---- 3. click a field value in a row => chip
await page.locator('.lrow .lmeta .val.bad').first().click();
await page.waitForSelector('.chip');
await waitStep('chip', 'click a field value to add a filter chip');
await page.locator('.lrow').nth(2).click();
await page.waitForSelector('.detail');
await page.waitForTimeout(500);
await page.locator('#log-query').blur();
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await shot('04-log-explorer.png');
await page.getByRole('button', { name: 'Close detail' }).click();

// virtualised list sanity over the whole 6h / 240k-row store
await page.getByRole('button', { name: 'Clear all' }).click();
await page.getByRole('button', { name: '6h', exact: true }).click();
await page.locator('#log-query').fill('level:info');
await page.waitForFunction(() => { const r = window.__pulse.getState().logView; return r && r.q === 'level:info' && r.res.scanned > 200000; }, null, { timeout: 15000 });
const domRows = await page.locator('.lrow').count();
const big = await page.evaluate(() => { const r = window.__pulse.getState().logView.res; return { matched: r.matched, scanned: r.scanned, ms: r.ms }; });
console.log('   6h level:info ->', JSON.stringify(big));
check('virtualised list renders a window, not every row', domRows < 80 && big.matched > 40000, `dom rows=${domRows}, matched=${big.matched}`);
await page.locator('#log-query').fill('level:error service:' + culprit);

// ---- 5. create an alert rule from the chart
await page.getByRole('button', { name: /^Overview/ }).click();
await page.waitForSelector('[data-chart="Latency p95"]');
// remove the chip filter so charts show all services again, then zoom back around the spike
await page.getByRole('button', { name: 'Reset time range to live' }).click();
await page.waitForTimeout(300);
await shot('05-mission-partial.png');
await page.getByRole('button', { name: /Create alert rule from Latency p95/ }).click();
await page.waitForSelector('[role="dialog"][aria-labelledby="ed-title"]');
await page.getByLabel('Name').fill('Checkout p95 latency high');
await page.getByLabel(/^Threshold/).fill('500');
await page.getByLabel('For (seconds)').fill('20');
await page.waitForTimeout(500);
const prev = await page.getByTestId('preview-sum').innerText();
check('alert editor shows live preview of would-fire intervals', /Would have fired/.test(prev), prev);
await shot('06-alert-rule-editor.png');
await page.getByRole('button', { name: 'Save rule' }).click();
await waitStep('rule', 'create an alert rule from the chart');

// ---- 6. watch it fire (worker evaluates continuously)
await page.getByRole('button', { name: /^Alerts/ }).click();
await waitStep('fire', 'watch the rule fire');
const live = await page.getByTestId('live-region').innerText();
check('alert announced in the aria-live region', /Alert fired/.test(live), live);

// ---- 7. declare an incident
await page.locator('tr[data-alert]').filter({ hasText: 'Checkout p95 latency high' }).getByRole('button', { name: 'Declare incident' }).click();
await waitStep('incident', 'declare an incident from an alert');
await page.waitForSelector('.timeline li');
await page.getByRole('button', { name: /identified$/i }).click();
await page.getByLabel('Add a note').fill('Latency started right after the retry-policy deploy. Rolling back.');
await page.keyboard.press('Enter');
await page.getByRole('button', { name: /Roll back latest deploy/ }).click();
await page.locator('.checklist label').nth(1).click();
await page.locator('.checklist label').nth(2).click();
await page.waitForTimeout(600);
await shot('07-incident-timeline.png');

// ---- 8. monitor, resolve, copy summary
await page.getByRole('button', { name: /monitoring$/i }).click();
await page.getByRole('button', { name: /resolved$/i }).click();
await page.getByRole('button', { name: /Copy summary/ }).click();
await waitStep('resolve', 'resolve and copy the post-mortem');
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('clipboard holds a markdown post-mortem', clip.startsWith('# INC-101') && clip.includes('## Timeline') && clip.includes('Rolled back'), `${clip.length} chars`);
check('summary includes real measured impact', /p95 latency peaked at \d/.test(clip));
await page.waitForTimeout(500);
check('mission completion card shown', await page.locator('.done-card').isVisible());

// ---- Show in charts jumps the global range
await page.getByRole('button', { name: /Show in charts/ }).first().click();
await page.waitForSelector('[data-chart="Latency p95"]');
const jumped = await page.evaluate(() => { const s = window.__pulse.getState(); return { tab: s.tab, live: s.live }; });
check('"Show in charts" jumps to the incident window', jumped.tab === 'overview' && !jumped.live);

// ---- URL round-trip: reload restores exact view
const hash = await page.evaluate(() => location.hash);
await page.waitForTimeout(400);
const hash2 = await page.evaluate(() => location.hash);
const before = await page.evaluate(() => { const s = window.__pulse.getState(); return [s.from, s.to, s.tab]; });
const p2 = await ctx.newPage();
await p2.goto(URL_ + hash2, { waitUntil: 'load' });
await p2.waitForFunction(() => window.__pulse?.getState().loaded);
const after = await p2.evaluate(() => { const s = window.__pulse.getState(); return [Math.round(s.from), Math.round(s.to), s.tab]; });
check('shareable URL restores the exact view', Math.abs(after[0] - before[0]) < 1000 && Math.abs(after[1] - before[1]) < 1000 && after[2] === before[2], hash2.slice(0, 80));
await p2.close();

// ---- Service map hover + filter click, command palette
await page.bringToFront();
await page.getByRole('button', { name: 'Reset time range to live' }).click();
await page.evaluate(() => window.scrollTo(0, 0));
await page.getByRole('button', { name: 'Minimize mission' }).click().catch(() => {});
await page.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 15000 });
const node = page.locator('g.node').filter({ hasText: 'checkout' });
await node.hover({ force: true });
await page.waitForTimeout(400);
await shot('08-service-map-hover.png');
await node.click({ force: true });
await page.waitForTimeout(300);
check('clicking a service filters everything (chip added)', await page.evaluate(() => window.__pulse.getState().chips.some((c) => c.field === 'service')));
await page.keyboard.press('Control+k');
await page.waitForSelector('[role="dialog"][aria-label="Command palette"] input:focus');
await page.keyboard.type('theme');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
check('command palette toggles the theme', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
await shot('09-light-theme.png');
await page.keyboard.press('Control+k');
await page.waitForSelector('[role="dialog"][aria-label="Command palette"] input:focus');
await page.keyboard.type('theme');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);

// ---- dark theme overview (live)
await page.evaluate(() => window.__pulse.setState({ chips: [] }));
await page.waitForTimeout(800);
await shot('10-dark-overview.png');

// ---- reseed replays with a different story
await page.getByRole('button', { name: /Open mission/ }).click();
await page.getByRole('button', { name: /Start a new simulated incident/ }).click();
await page.waitForFunction(() => window.__pulse.getState().loaded && window.__pulse.getState().seed === 2, null, { timeout: 30000 });
const c2 = await st();
check('new simulated incident re-runs a different seed (different culprit)', c2.culprit !== culprit, `${culprit} -> ${c2.culprit}`);
check('mission reset after reseed', !(await stepDone('zoom')));

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);
