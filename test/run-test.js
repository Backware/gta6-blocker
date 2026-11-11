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

  // The extension's own GitHub repo is never blocked (hardcoded exception).
  const urls = {
    'https://github.com/Backware/gta6-blocker': true,
    'https://github.com/backware/GTA6-Blocker/issues/1': true,
    'https://github.com/Backware/gta6-blocker.git': true,
    'https://www.github.com/Backware/gta6-blocker/releases': true,
    'https://raw.githubusercontent.com/Backware/gta6-blocker/main/README.md': true,
    'https://codeload.github.com/Backware/gta6-blocker/zip/refs/heads/main': true,
    'https://github.com/Backware/gta6-blocker-fork': false,
    'https://github.com/someone/gta6-blocker': false,
    'https://evil.example/Backware/gta6-blocker': false
  };
  for (const [u, want] of Object.entries(urls)) {
    check('isProjectUrl ' + u + ' = ' + want, (await sw.evaluate((x) => globalThis.GTA6.isProjectUrl(x), u)) === want);
  }
  const githubPage = fs.readFileSync(path.join(__dirname, 'github.html'));
  await page.route(/^https:\/\/(github\.com|raw\.githubusercontent\.com)\//, (route) =>
    route.fulfill({ contentType: 'text/html', body: githubPage }));
  const isBlocked = () => page.evaluate(() => document.documentElement.hasAttribute('data-gta6-page-blocked'));
  for (const u of ['https://github.com/Backware/gta6-blocker', 'https://github.com/Backware/gta6-blocker/issues?q=gta+6',
    'https://raw.githubusercontent.com/Backware/gta6-blocker/main/README.md']) {
    await page.goto(u).catch(() => {});
    await page.waitForTimeout(600);
    check('github exception: not redirected ' + u, page.url() === u);
    check('github exception: page not blocked ' + u, !(await isBlocked()));
    check('github exception: nothing hidden ' + u, (await page.$$('[data-gta6-blocked]')).length === 0);
  }
  // Control: any other GTA repo is still blocked.
  await page.goto('https://github.com/someone/gta6-mods').catch(() => {});
  await page.waitForTimeout(500);
  check('github: other GTA repo redirected', page.url().endsWith('/blocked/blocked.html'));
  // Navigating away from the repo inside GitHub (no reload) turns blocking back on.
  await page.goto('https://github.com/Backware/gta6-blocker');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    history.pushState({}, '', '/someone/gta6-mods');
    document.title = 'someone/gta6-mods';
  });
  await page.waitForTimeout(800);
  check('github: leaving the repo via SPA navigation blocks again', await isBlocked());
  await page.unrouteAll();

  // Twitch, "remove completely" mode: GTA streams (any GTA category) are
  // hidden from the sidebar and directory, and a channel page streaming GTA
  // is blocked.
  await page.route('https://www.twitch.tv/**', (route) => {
    const file = new URL(route.request().url()).pathname.startsWith('/directory') ? 'twitch-directory.html' : 'twitch-channel.html';
    route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, file)) });
  });
  check('twitch: default mode is warn', (await sw.evaluate(() => globalThis.GTA6.getSettings())).twitchMode === 'warn');
  await sw.evaluate(() => chrome.storage.local.set({ twitchMode: 'hide' }));
  await page.goto('https://www.twitch.tv/directory/all');
  await page.waitForTimeout(800);
  check('twitch: directory page not blocked', !(await isBlocked()));
  const twHidden = (id) => page.$eval('#' + id, (el) => !!el.closest('[data-gta6-blocked]'));
  for (const id of ['sn1', 'sn2', 'c1', 'c2', 'c3', 'g1']) check('twitch: hides ' + id, await twHidden(id));
  for (const id of ['sn3', 'c4', 'g2']) check('twitch: keeps ' + id, !(await twHidden(id)));
  check('twitch: hides whole grid cell', await page.$eval('#c2', (el) => el.hasAttribute('data-gta6-blocked')));
  check('twitch: hides whole sidebar entry', await page.$eval('#sn2', (el) => el.hasAttribute('data-gta6-blocked')));

  await page.goto('https://www.twitch.tv/retrogamer');
  await page.waitForTimeout(1000);
  check('twitch: GTA IV stream page blocked', await isBlocked());
  await page.goto('https://www.twitch.tv/rpstreamer');
  await page.waitForTimeout(1000);
  check('twitch: GTA V stream page blocked', await isBlocked());
  await page.goto('https://www.twitch.tv/blockbuilder');
  await page.waitForTimeout(1000);
  check('twitch: Minecraft stream page not blocked', !(await isBlocked()));
  // Streamer switches to GTA mid-stream, then away again.
  await page.evaluate(() => {
    const a = document.querySelector('[data-a-target="stream-game-link"]');
    a.textContent = 'Grand Theft Auto VI';
    a.href = '/directory/category/grand-theft-auto-vi';
  });
  await page.waitForTimeout(800);
  check('twitch: switching to GTA mid-stream blocks', await isBlocked());
  await page.evaluate(() => {
    const a = document.querySelector('[data-a-target="stream-game-link"]');
    a.textContent = 'Minecraft';
    a.href = '/directory/category/minecraft';
  });
  await page.waitForTimeout(800);
  check('twitch: switching away from GTA unblocks', !(await isBlocked()));

  // Twitch, default "mark red and warn" mode.
  await sw.evaluate(() => chrome.storage.local.set({ twitchMode: 'warn' }));
  const warning = () => page.evaluate(() => !!document.querySelector('gta6-twitch-warning'));
  const redFrame = () => page.evaluate(() => document.documentElement.hasAttribute('data-gta6-gta-stream'));
  const flagged = (id) => page.$eval('#' + id, (el) => !!el.closest('[data-gta6-flagged]'));
  await page.goto('https://www.twitch.tv/directory/all');
  await page.waitForTimeout(800);
  for (const id of ['sn1', 'sn2', 'c1', 'c2', 'c3', 'g1']) {
    check('twitch warn: marks ' + id + ' red', await flagged(id));
    check('twitch warn: does not hide ' + id, !(await twHidden(id)));
  }
  for (const id of ['sn3', 'c4', 'g2']) check('twitch warn: leaves ' + id + ' unmarked', !(await flagged(id)));
  // Clicking a red stream warns before the stream is opened.
  await page.click('#c2 a[href="/retrogamer"]');
  await page.waitForTimeout(500);
  check('twitch warn: click on red stream shows warning first', await warning());
  check('twitch warn: stream not opened yet', page.url().endsWith('/directory/all'));
  await page.click('#gta6-back');
  await page.waitForTimeout(300);
  check('twitch warn: "Go back" stays on the list', !(await warning()) && page.url().endsWith('/directory/all'));
  await page.click('#c2 a[href="/retrogamer"]');
  await page.waitForTimeout(300);
  await Promise.all([page.waitForURL('**/retrogamer'), page.click('#gta6-continue')]);
  await page.waitForTimeout(1000);
  check('twitch warn: "Watch anyway" opens the stream without a second warning', !(await warning()));
  check('twitch warn: stream shown with red frame', await redFrame());
  check('twitch warn: stream page not blocked', !(await isBlocked()));
  // Opening a GTA stream directly: warning in front of the paused player.
  await page.goto('https://www.twitch.tv/rpstreamer');
  await page.waitForTimeout(1000);
  check('twitch warn: direct visit shows warning', await warning());
  check('twitch warn: direct visit red frame', await redFrame());
  await page.click('#gta6-continue');
  await page.waitForTimeout(300);
  check('twitch warn: "Watch anyway" removes warning', !(await warning()));
  await page.goto('https://www.twitch.tv/blockbuilder');
  await page.waitForTimeout(1000);
  check('twitch warn: non-GTA stream has no warning or frame', !(await warning()) && !(await redFrame()));
  await page.unrouteAll();

  // Settings page: the Twitch choice is saved.
  await page.goto('chrome-extension://' + new URL(sw.url()).host + '/options/options.html');
  await page.waitForTimeout(300);
  check('options: warn selected by default', await page.isChecked('input[name="twitchMode"][value="warn"]'));
  await page.check('input[name="twitchMode"][value="hide"]');
  await page.waitForTimeout(300);
  check('options: "remove completely" saved', (await sw.evaluate(() => chrome.storage.local.get('twitchMode'))).twitchMode === 'hide');
  await sw.evaluate(() => chrome.storage.local.set({ twitchMode: 'warn' }));

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
