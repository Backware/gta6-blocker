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
    // Twitch GTA streams: 'warn' = mark red + warning before opening,
    // 'hide' = remove them completely.
    twitchMode: 'warn',
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

  // The extension's own repository is never blocked, whatever the settings
  // say: its name, README and issues are full of "GTA 6", but you need to be
  // able to read the docs, file issues and download releases. Hardcoded on
  // purpose so it can't be removed from the settings page.
  // Keep in sync with the "allow" rules (ids 100-102) in rules/rules.json.
  const PROJECT_OWNER = 'backware';
  const PROJECT_REPO = 'gta6-blocker';

  function isProjectUrl(href) {
    let u;
    try {
      u = new URL(String(href || ''));
    } catch (e) {
      return false;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.toLowerCase().split('/').filter(Boolean);
    const repo = (parts[1] || '').replace(/\.git$/, '');
    const isRepoPath = parts[0] === PROJECT_OWNER && repo === PROJECT_REPO;
    // github.com/Backware/gta6-blocker and every page below it (code, issues,
    // pull requests, releases, wiki, ...), plus raw files and zip downloads.
    if (host === 'github.com' || host === 'www.github.com') return isRepoPath;
    if (host === 'raw.githubusercontent.com' || host === 'codeload.github.com') return isRepoPath;
    // GitHub Pages site of the repo, if one is ever published.
    if (host === PROJECT_OWNER + '.github.io') return parts[0] === PROJECT_REPO;
    return false;
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
    isProjectUrl,
    getSettings,
    setSettings
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
