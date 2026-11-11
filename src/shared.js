/*
 * Shared helpers used by the content script, popup, options page and
 * background worker. Kept dependency-free so it works in Chrome and Safari.
 */
(function (root) {
  'use strict';

  const ext = root.browser || root.chrome;

  // Everything Grand Theft Auto, so nothing GTA 6 related (or spoilers via
  // older games, GTA Online, characters, places) slips through.
  const DEFAULT_KEYWORDS = [
    'GTA',
    'GTA 6',
    'GTA VI',
    'GTA6',
    'GTAVI',
    'GTA 5',
    'GTA V',
    'GTA5',
    'GTAV',
    'GTA Online',
    'GTA Vice City',
    'Grand Theft Auto',
    'GrandTheftAuto',
    'Vice City',
    'ViceCity',
    'Rockstar Games VI',
    'Jason and Lucia',
    'Lucia and Jason',
    'Jason Duval',
    'Lucia Caminos',
    'Leonida',
    'Port Gellhorn',
    'Ambrosia County'
  ];

  const DEFAULT_SETTINGS = {
    enabled: true,
    networkBlocking: true,
    keywords: DEFAULT_KEYWORDS,
    allowlist: [],
    blockedTotal: 0
  };

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Turn the keyword list into one case-insensitive RegExp.
   * - Spaces in a keyword match any run of spaces, dashes, dots, underscores,
   *   colons or nothing at all, so "GTA 6" also catches "GTA-6", "gta_6", "GTA:6".
   * - Keywords must sit on word boundaries, so "GTA" won't match "Agtamon".
   * - Hashtags are matched by prefix: "Vice City" also catches "#vicecityvibes",
   *   "GTA" catches "#gtaonline", "#gta6leaks", "#gtarp" and so on.
   */
  function buildMatcher(keywords) {
    const list = (keywords || []).map((k) => String(k).trim()).filter(Boolean);
    if (!list.length) return null;
    const SEP = '[\\s\\-_.:#\\u00a0]*';
    const words = list.map((k) => k.split(/\s+/).map(escapeRegExp).join(SEP));
    const tags = list.map((k) => escapeRegExp(k.replace(/\s+/g, '')));
    // Longest first so alternation prefers the most specific match.
    words.sort((a, b) => b.length - a.length);
    tags.sort((a, b) => b.length - a.length);
    return new RegExp(
      '(?:^|[^\\p{L}\\p{N}])(?:' + words.join('|') + ')(?![\\p{L}\\p{N}])' +
        '|[#\\uFF03](?:' + tags.join('|') + ')',
      'iu'
    );
  }

  function normalizeHost(host) {
    return String(host || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '');
  }

  function isAllowlisted(hostname, allowlist) {
    const host = normalizeHost(hostname);
    return (allowlist || []).some((entry) => {
      const e = normalizeHost(entry);
      return e && (host === e || host.endsWith('.' + e));
    });
  }

  async function getSettings() {
    const stored = await ext.storage.local.get(DEFAULT_SETTINGS);
    return Object.assign({}, DEFAULT_SETTINGS, stored);
  }

  function setSettings(patch) {
    return ext.storage.local.set(patch);
  }

  root.GTA6 = {
    ext,
    DEFAULT_KEYWORDS,
    DEFAULT_SETTINGS,
    buildMatcher,
    normalizeHost,
    isAllowlisted,
    getSettings,
    setSettings
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
