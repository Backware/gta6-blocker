// Regenerates the README screenshots in docs/screenshots/.
// Usage (from the repo root): npm install && npx playwright install chromium && node docs/demo/take-screenshots.js
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const EXT = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'docs/screenshots');
const demo = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await chromium.launchPersistentContext('', {
    headless: true,
    channel: 'chromium',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT]
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const extId = sw.url().split('/')[2];
  await ctx.route('https://demotube.example/**', (r) => r.fulfill({ contentType: 'text/html', body: demo('feed.html') }));
  await ctx.route('https://www.youtube.com/shorts/**', (r) => r.fulfill({ contentType: 'text/html', body: demo('shorts.html') }));
  const setEnabled = (on) => sw.evaluate((v) => chrome.storage.local.set({ enabled: v }), on);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const page = await ctx.newPage();

  // Before / after on the same feed.
  await setEnabled(false);
  await wait(300);
  await page.goto('https://demotube.example/');
  await wait(600);
  await page.screenshot({ path: path.join(OUT, 'feed-before.png') });
  await setEnabled(true);
  await wait(300);
  await page.reload();
  await wait(1000);
  await page.screenshot({ path: path.join(OUT, 'feed-after.png') });
  // Same page, but show the hidden items marked in red instead of removing them.
  await page.addStyleTag({ content: `
    [data-gta6-blocked] { display: block !important; position: relative !important; outline: 3px solid #e5484d; outline-offset: 2px; border-radius: 12px; }
    [data-gta6-blocked] > * { opacity: .35; filter: grayscale(1) blur(1px); }
    [data-gta6-blocked]::after { content: "Hidden by GTA 6 Blocker"; position: absolute; top: 8px; left: 8px; background: #e5484d; color: #fff;
      font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 6px 8px; border-radius: 6px; }
    .posts article[data-gta6-blocked] { display: block !important; }` });
  await wait(200);
  await page.screenshot({ path: path.join(OUT, 'feed-highlighted.png') });

  // Shorts: GTA video covered, the next one untouched.
  await page.setViewportSize({ width: 760, height: 600 });
  await page.goto('https://www.youtube.com/shorts/demo');
  await wait(1000);
  await page.screenshot({ path: path.join(OUT, 'shorts.png') });

  // Search for "gta 6" is stopped before it loads.
  await page.setViewportSize({ width: 1000, height: 600 });
  await page.goto('https://www.google.com/search?q=gta+6').catch(() => {});
  await wait(600);
  await page.screenshot({ path: path.join(OUT, 'blocked-page.png') });

  // Popup, showing the real counter of the demo feed tab.
  await page.goto('https://demotube.example/');
  await wait(1000);
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 300, height: 330 });
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://demotube.example/*' });
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'gta6:getCount' });
    document.getElementById('tabCount').textContent = r.count;
    document.getElementById('host').textContent = 'demotube.example';
    document.getElementById('siteRow').hidden = false;
    document.getElementById('siteEnabled').checked = true;
  });
  await wait(600); // let the switch animations finish
  await popup.screenshot({ path: path.join(OUT, 'popup.png') });

  // Settings page.
  await popup.setViewportSize({ width: 800, height: 1000 });
  await popup.goto(`chrome-extension://${extId}/options/options.html`);
  await wait(500);
  await popup.screenshot({ path: path.join(OUT, 'settings.png'), fullPage: true });

  await ctx.close();
  console.log('Screenshots written to', OUT);
})();
