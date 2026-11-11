// Headless smoke test: loads the unpacked extension in Chromium and checks
// that GTA 6 content is hidden and other content is left alone.
// Usage: npm install --no-save playwright && npx playwright install chromium && node test/run-test.js
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '../src');
const server = http.createServer((req, res) => {
  const file = req.url.startsWith('/title') ? 'titlepage.html'
    : req.url.startsWith('/shorts') ? 'shorts.html' : 'fixture.html';
  res.setHeader('content-type', 'text/html');
  res.end(fs.readFileSync(path.join(__dirname, file)));
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const ctx = await chromium.launchPersistentContext('', {
    headless: true,
    channel: 'chromium', // new headless mode, which supports extensions
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT]
  });
  let failures = 0;
  const check = (name, ok) => {
    console.log((ok ? 'PASS ' : 'FAIL ') + name);
    if (!ok) failures++;
  };

  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  check('service worker running', !!sw);
  await new Promise((r) => setTimeout(r, 500));

  // Chrome silently skips regex rules that are too complex, so check each one.
  const rules = JSON.parse(fs.readFileSync(path.join(EXT, 'rules/rules.json'), 'utf8'));
  for (const r of rules.filter((x) => x.condition.regexFilter)) {
    const res = await sw.evaluate((rx) => chrome.declarativeNetRequest.isRegexSupported({ regex: rx, isCaseSensitive: false }), r.condition.regexFilter);
    check('rule ' + r.id + ' regex supported', res.isSupported);
  }

  const page = await ctx.newPage();
  await page.goto(base + '/');
  await page.waitForTimeout(1200);
  const hidden = (id) => page.$eval('#' + id, (el) => !!el.closest('[data-gta6-blocked]'));
  for (const id of ['v1', 'v3', 'v4', 'g1', 'g2', 'g3', 'g4', 'g5', 'p1', 'd1', 'ig1', 'ig2']) check('hides ' + id, await hidden(id));
  for (const id of ['v2', 'p2', 'd2', 'ig3', 'ig4', 'search']) check('keeps ' + id, !(await hidden(id)));

  await page.goto(base + '/title');
  await page.waitForTimeout(800);
  check('blocks page by title', await page.evaluate(() => document.documentElement.hasAttribute('data-gta6-page-blocked')));

  // Swipe feeds: the matching Short is covered, the feed itself stays usable.
  // (Served from a fake host so the content script sees a youtube.com/shorts URL.)
  await page.route('https://www.youtube.com/shorts/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, 'shorts.html')) }));
  await page.goto('https://www.youtube.com/shorts/abc123');
  await page.waitForTimeout(800);
  check('shorts: page not fully blocked', !(await page.evaluate(() => document.documentElement.hasAttribute('data-gta6-page-blocked'))));
  check('shorts: GTA short covered', await page.$eval('#s1', (el) => el.hasAttribute('data-gta6-covered')));
  check('shorts: other short playable', !(await page.$eval('#s2', (el) => el.hasAttribute('data-gta6-covered'))));

  await page.goto(base + '/search?q=gta+6').catch(() => {});
  await page.waitForTimeout(500);
  check('redirects search URL to block page', page.url().endsWith('/blocked/blocked.html'));

  await page.goto(base + '/search?q=grand+theft+auto+v').catch(() => {});
  await page.waitForTimeout(300);
  check('redirects any GTA search', page.url().endsWith('/blocked/blocked.html'));

  await page.goto(base + '/search?q=minecraft').catch(() => {});
  await page.waitForTimeout(300);
  check('does not redirect unrelated search', page.url().startsWith(base));

  await page.goto('https://www.rockstargames.com/VI').catch(() => {});
  await page.waitForTimeout(500);
  check('redirects rockstargames.com/VI', page.url().endsWith('/blocked/blocked.html'));

  // Turn off and confirm content comes back.
  await sw.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await page.waitForTimeout(300);
  await page.goto(base + '/');
  await page.waitForTimeout(800);
  check('disabled: nothing hidden', (await page.$$('[data-gta6-blocked]')).length === 0);
  await page.goto(base + '/search?q=gta+6').catch(() => {});
  check('disabled: search not redirected', page.url().startsWith(base));

  await ctx.close();
  server.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
