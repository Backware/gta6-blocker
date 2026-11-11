(async function () {
  'use strict';
  const { ext, getSettings, setSettings, normalizeHost, isAllowlisted } = globalThis.GTA6;
  const $ = (id) => document.getElementById(id);

  const s = await getSettings();
  $('enabled').checked = s.enabled;
  $('total').textContent = s.blockedTotal || 0;

  let tab = null;
  try {
    [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  } catch (e) { /* ignore */ }

  let host = '';
  try { host = tab && tab.url ? normalizeHost(new URL(tab.url).hostname) : ''; } catch (e) { /* ignore */ }
  if (host && /^https?:/.test(tab.url)) {
    $('host').textContent = host;
    $('siteEnabled').checked = !isAllowlisted(host, s.allowlist);
  } else {
    $('siteRow').hidden = true;
  }

  if (tab && tab.id != null) {
    try {
      const r = await ext.tabs.sendMessage(tab.id, { type: 'gta6:getCount' });
      if (r) $('tabCount').textContent = r.pageBlocked ? 'Page' : r.count;
    } catch (e) { /* no content script on this page */ }
  }

  $('enabled').addEventListener('change', (e) => setSettings({ enabled: e.target.checked }));

  $('siteEnabled').addEventListener('change', async (e) => {
    const cur = await getSettings();
    let list = (cur.allowlist || []).filter((d) => normalizeHost(d) !== host);
    if (!e.target.checked) list.push(host);
    await setSettings({ allowlist: list });
  });

  $('options').addEventListener('click', () => {
    ext.runtime.openOptionsPage();
    window.close();
  });
})();
