/*
 * Background service worker: keeps the network rules in sync with the
 * settings and shows a per-tab badge with the number of hidden items.
 */
importScripts('shared.js');

const { ext, DEFAULT_SETTINGS, getSettings, setSettings } = globalThis.GTA6;
const RULESET_ID = 'gta6_rules';

async function syncRules() {
  const s = await getSettings();
  const on = !!(s.enabled && s.networkBlocking);
  try {
    await ext.declarativeNetRequest.updateEnabledRulesets(
      on ? { enableRulesetIds: [RULESET_ID] } : { disableRulesetIds: [RULESET_ID] }
    );
  } catch (e) {
    console.warn('[GTA 6 Blocker] could not update rulesets', e);
  }
  // Allowlisted sites: let them through the network rules too.
  try {
    const existing = await ext.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map((r) => r.id);
    const domains = (s.allowlist || []).map(globalThis.GTA6.normalizeHost).filter(Boolean);
    const addRules = domains.length
      ? [{
          id: 1000,
          priority: 100,
          action: { type: 'allow' },
          condition: { requestDomains: domains, resourceTypes: ['main_frame', 'sub_frame'] }
        }]
      : [];
    await ext.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } catch (e) {
    console.warn('[GTA 6 Blocker] could not update allowlist rules', e);
  }
  updateIcon(s.enabled);
}

function updateIcon(enabled) {
  try {
    ext.action.setBadgeBackgroundColor({ color: '#e5484d' });
    ext.action.setTitle({ title: enabled ? 'GTA 6 Blocker (on)' : 'GTA 6 Blocker (off)' });
    if (!enabled) ext.action.setBadgeText({ text: 'off' });
    else ext.action.setBadgeText({ text: '' });
  } catch (e) { /* ignore */ }
}

ext.runtime.onInstalled.addListener(async (details) => {
  const current = await ext.storage.local.get(null);
  const patch = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(k in current)) patch[k] = v;
  }
  // On update, add any new default keywords without removing the user's own.
  if (details && details.reason === 'update' && Array.isArray(current.keywords)) {
    const have = new Set(current.keywords.map((k) => k.toLowerCase()));
    const added = DEFAULT_SETTINGS.keywords.filter((k) => !have.has(k.toLowerCase()));
    if (added.length) patch.keywords = current.keywords.concat(added);
  }
  if (Object.keys(patch).length) await setSettings(patch);
  syncRules();
});

ext.runtime.onStartup && ext.runtime.onStartup.addListener(syncRules);

ext.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.enabled || changes.networkBlocking || changes.allowlist)) syncRules();
});

// Per-tab counter coming from the content script (top frame wins).
const lastCounts = new Map();
ext.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'gta6:count' || !sender.tab) return;
  const tabId = sender.tab.id;
  const prev0 = lastCounts.get(tabId) || 0;
  const prev = msg.count < prev0 ? 0 : prev0; // page reloaded / navigated
  const delta = Math.max(0, msg.count - prev);
  if (sender.frameId === 0 || sender.frameId === undefined) lastCounts.set(tabId, msg.count);
  const text = msg.pageBlocked ? '!' : msg.count > 0 ? String(Math.min(msg.count, 999)) : '';
  try { ext.action.setBadgeText({ tabId, text }); } catch (e) { /* ignore */ }
  if (delta > 0) {
    getSettings().then((s) => setSettings({ blockedTotal: (s.blockedTotal || 0) + delta }));
  }
});

ext.tabs && ext.tabs.onRemoved && ext.tabs.onRemoved.addListener((tabId) => lastCounts.delete(tabId));
