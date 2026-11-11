(async function () {
  'use strict';
  const { getSettings, setSettings, DEFAULT_KEYWORDS } = globalThis.GTA6;
  const $ = (id) => document.getElementById(id);
  const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

  async function load() {
    const s = await getSettings();
    $('enabled').checked = s.enabled;
    $('networkBlocking').checked = s.networkBlocking;
    $('keywords').value = (s.keywords || []).join('\n');
    $('allowlist').value = (s.allowlist || []).join('\n');
  }

  function flash(msg) {
    $('status').textContent = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => ($('status').textContent = ''), 2500);
  }

  $('enabled').addEventListener('change', (e) => setSettings({ enabled: e.target.checked }).then(() => flash('Saved')));
  $('networkBlocking').addEventListener('change', (e) => setSettings({ networkBlocking: e.target.checked }).then(() => flash('Saved')));

  $('save').addEventListener('click', async () => {
    const keywords = lines($('keywords').value);
    if (!keywords.length) return flash('Add at least one keyword.');
    await setSettings({ keywords, allowlist: lines($('allowlist').value) });
    flash('Saved. Open tabs update automatically.');
  });

  $('reset').addEventListener('click', () => {
    $('keywords').value = DEFAULT_KEYWORDS.join('\n');
    flash('Defaults restored. Press Save to apply.');
  });

  load();
})();
