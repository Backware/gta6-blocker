/*
 * GTA 6 Blocker content script.
 *
 * 1. Page level: if the page URL or title is about GTA 6, cover it with a
 *    full-screen block screen and pause any media.
 * 2. Element level: scan text, link targets, alt/title/aria-label attributes
 *    and hide the surrounding "card" (search result, video tile, post, ...).
 * 3. A MutationObserver keeps doing this for infinite scroll and SPA pages
 *    (YouTube, Reddit, X, TikTok, ...).
 */
(function () {
  'use strict';
  if (window.__gta6BlockerLoaded) return;
  window.__gta6BlockerLoaded = true;

  const { ext, buildMatcher, isAllowlisted, getSettings } = globalThis.GTA6;
  const isTopFrame = window.top === window;

  // Site-specific "cards": when a match is found inside one of these, the
  // whole card is hidden. Order does not matter; the closest match wins.
  const CARD_SELECTORS = [
    // YouTube
    'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer',
    'ytd-grid-video-renderer', 'ytd-playlist-renderer', 'ytd-radio-renderer',
    'ytd-channel-renderer', 'ytd-reel-item-renderer', 'ytd-reel-video-renderer',
    'ytd-rich-section-renderer', 'ytd-comment-thread-renderer', 'ytd-post-renderer',
    'ytd-backstage-post-thread-renderer', 'ytd-movie-renderer', 'ytd-shelf-renderer',
    'ytm-shorts-lockup-view-model', 'ytm-shorts-lockup-view-model-v2',
    'ytd-hashtag-tile-renderer', 'ytd-notification-renderer', 'ytd-guide-entry-renderer', 'yt-lockup-view-model',
    'ytm-video-with-context-renderer', 'ytm-compact-video-renderer', 'ytm-rich-item-renderer',
    // Google
    'div.MjjYud', 'div.g', 'g-inner-card', 'div[jscontroller][data-hveid] > div.SoaBEf',
    'g-section-with-header', 'div[data-news-cluster-id]', 'block-component',
    // Bing / DuckDuckGo / Ecosia / Brave / Yahoo
    'li.b_algo', 'li.b_ans', 'div.news-card', 'article[data-testid="result"]',
    'li[data-layout="organic"]', 'div.result', 'div.snippet', 'div.algo', 'li.ov-a',
    // Reddit
    'shreddit-post', 'shreddit-comment', 'faceplate-tracker[noun="post"]', 'div.thing',
    'search-telemetry-tracker', 'reddit-pdp-right-rail-post',
    // X / Twitter, Bluesky, Threads, Mastodon
    'article[data-testid="tweet"]', 'div[data-testid="cellInnerDiv"]', 'div[data-testid="feedItem-by-"]',
    'div.status', 'article.status',
    // Facebook / Instagram (feed posts, explore/profile grid tiles, comments)
    'div[role="article"]', 'article', 'a[href^="/p/"]', 'a[href^="/reel/"]', 'a[href*="/reel/"]',
    'div[role="dialog"] ul > div',
    // TikTok
    'div[data-e2e="recommend-list-item-container"]', 'div[data-e2e="search_top-item"]',
    'div[data-e2e="user-post-item"]',
    // Twitch
    'div[data-a-target="card"]', 'article[data-a-target]', 'div.tw-tower > div',
    // Steam / stores / generic news
    'a.search_result_row', 'div.tab_item', 'li.c-entry-box', 'div.c-entry-box',
    // Generic
    '[role="listitem"]', '[role="option"]', 'li', 'tr', 'figure'
  ].join(',');

  // Full-screen, swipe-style video feeds. Hiding an item there would break
  // scrolling, so matching items are covered with a block screen and muted.
  const PLAYER_SELECTORS = [
    'ytd-reel-video-renderer', 'ytm-reel-player-overlay-renderer', 'ytm-shorts-player',
    'div[data-e2e="recommend-list-item-container"]', 'article[data-e2e="recommend-list-item-container"]',
    'div[data-e2e="feed-video"]', 'section[data-e2e="feed-video"]'
  ].join(',');
  const BLOCKED_SEL = '[data-gta6-blocked],[data-gta6-covered]';

  function isSnapFeed() {
    const h = location.hostname;
    const p = location.pathname;
    return (/(^|\.)youtube\.com$/.test(h) && p.startsWith('/shorts')) ||
      (/(^|\.)instagram\.com$/.test(h) && /^\/(reels?|stories)\//.test(p)) ||
      /(^|\.)tiktok\.com$/.test(h) ||
      (/(^|\.)facebook\.com$/.test(h) && /^\/(reel|watch)/.test(p));
  }

  // Never hide these (or walk above them).
  const NEVER_HIDE = new Set(['HTML', 'BODY', 'HEAD', 'MAIN']);
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'TEMPLATE', 'SVG', 'CODE']);
  const ATTRS = ['title', 'alt', 'aria-label', 'href', 'data-title', 'data-tooltip-text'];

  let matcher = null;
  let enabled = false;
  let blockedCount = 0;
  let pageBlocked = false;
  let overlayHost = null;
  let observer = null;
  let scheduled = false;
  const pendingRoots = new Set();
  let lastUrl = location.href;
  let lastTitle = '';

  // ---------- helpers ----------

  function matches(text) {
    return !!(matcher && text && matcher.test(text));
  }

  function safeDecode(s) {
    try {
      return decodeURIComponent(s.replace(/\+/g, ' '));
    } catch (e) {
      return s;
    }
  }

  function urlMatches(href) {
    if (!href) return false;
    let u;
    try {
      u = new URL(href, location.href);
    } catch (e) {
      return false;
    }
    const text = [u.hostname, safeDecode(u.pathname), safeDecode(u.search)]
      .join(' ')
      // Hashtag pages: /explore/tags/gtaonline, /hashtag/GTA6, /tag/gta -> "#gtaonline"
      .replace(/\/(?:explore\/tags|hashtags?|tags?)\/([^/?#]+)/gi, ' #$1 ')
      .replace(/[/?=&+]/g, ' ');
    return matches(text);
  }

  function isEditable(el) {
    return !!(el && el.closest && el.closest('[contenteditable=""], [contenteditable="true"], input, textarea'));
  }

  /** Find the best container to hide for a matching node. */
  function containerFor(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.closest(BLOCKED_SEL)) return null;
    if (isEditable(el)) return null;

    const card = el.closest(CARD_SELECTORS);
    if (card && !NEVER_HIDE.has(card.tagName)) return card;

    // Fallback: climb to a reasonable block-level ancestor, but never so far
    // that we'd hide most of the page.
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
    let node = el;
    let best = el;
    for (let i = 0; i < 6 && node && !NEVER_HIDE.has(node.tagName); i++) {
      const r = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
      if (r && r.width * r.height > viewportArea * 0.6) break;
      best = node;
      const display = getComputedStyle(node).display;
      if (/^(block|flex|grid|list-item|table)/.test(display) && node.tagName !== 'A' && node.tagName !== 'SPAN') {
        if (/^(P|H[1-6]|LI|ARTICLE|SECTION|ASIDE|FIGURE|DIV)$/.test(node.tagName)) break;
      }
      node = node.parentElement;
    }
    return NEVER_HIDE.has(best.tagName) ? null : best;
  }

  /** In a swipe feed: the nearest ancestor holding a video and filling most of the screen. */
  function playerFor(el) {
    const known = el.closest(PLAYER_SELECTORS);
    if (known) return known;
    const minH = window.innerHeight * 0.5;
    for (let node = el; node && !NEVER_HIDE.has(node.tagName); node = node.parentElement) {
      if (node.querySelector && node.querySelector('video') && node.getBoundingClientRect().height >= minH) return node;
    }
    return null;
  }

  let coverTimer = null;
  function cover(target) {
    target.setAttribute('data-gta6-covered', '');
    pauseIn(target);
    // Feeds autoplay the next video and reuse players, so keep enforcing.
    if (!coverTimer) {
      coverTimer = setInterval(() => {
        const covered = document.querySelectorAll('[data-gta6-covered]');
        if (!covered.length) { clearInterval(coverTimer); coverTimer = null; return; }
        covered.forEach(pauseIn);
      }, 400);
    }
  }

  function pauseIn(root) {
    root.querySelectorAll('video, audio').forEach((m) => {
      try { if (!m.paused) m.pause(); m.muted = true; } catch (e) { /* ignore */ }
    });
  }

  function hide(el) {
    if (!el || el.nodeType !== 1 || el.closest(BLOCKED_SEL) || isEditable(el)) return;
    if (isSnapFeed()) {
      const player = playerFor(el);
      if (player) {
        cover(player);
        blockedCount++;
        reportCount();
        return;
      }
    }
    const target = containerFor(el);
    if (!target) return;
    target.setAttribute('data-gta6-blocked', '');
    target.querySelectorAll('video, audio').forEach((m) => {
      try { m.pause(); m.muted = true; } catch (e) { /* ignore */ }
    });
    blockedCount++;
    reportCount();
  }

  let reportTimer = null;
  function reportCount() {
    if (reportTimer) return;
    reportTimer = setTimeout(() => {
      reportTimer = null;
      try {
        ext.runtime.sendMessage({ type: 'gta6:count', count: blockedCount, pageBlocked }).catch(() => {});
      } catch (e) { /* extension reloaded */ }
    }, 300);
  }

  // ---------- element scanning ----------

  function scanText(root) {
    if (!root) return;
    const doc = root.ownerDocument || root;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
        if (p.closest(BLOCKED_SEL)) return NodeFilter.FILTER_REJECT;
        return node.nodeValue.length > 2 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    const hits = [];
    let n;
    while ((n = walker.nextNode())) {
      if (matches(n.nodeValue)) hits.push(n.parentElement);
    }
    // Text can be split across siblings ("GTA <b>6</b>"): check element text
    // of small inline containers too.
    if (root.querySelectorAll) {
      root.querySelectorAll('a, h1, h2, h3, h4, span, yt-formatted-string, p').forEach((el) => {
        if (el.closest(BLOCKED_SEL)) return;
        const t = el.textContent;
        if (t && t.length < 400 && matches(t)) hits.push(el);
      });
    }
    hits.forEach(hide);
  }

  function scanAttributes(root) {
    if (!root || !root.querySelectorAll) return;
    const sel = ATTRS.map((a) => '[' + a + ']').join(',');
    const els = Array.from(root.querySelectorAll(sel));
    if (root.nodeType === 1 && root.matches(sel)) els.push(root);
    for (const el of els) {
      if (el.closest(BLOCKED_SEL)) continue;
      if (SKIP_TAGS.has(el.tagName.toUpperCase()) && el.tagName !== 'INPUT') continue;
      let hit = false;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        if (a === 'href' ? urlMatches(v) : matches(v)) { hit = true; break; }
      }
      if (hit) hide(el);
    }
  }

  function scan(root) {
    if (!enabled || pageBlocked || !matcher) return;
    scanText(root);
    scanAttributes(root);
    // Open shadow roots (Reddit, some YouTube parts).
    if (root.querySelectorAll) {
      root.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot && !el.shadowRoot.__gta6Observed) {
          el.shadowRoot.__gta6Observed = true;
          scanText(el.shadowRoot);
          scanAttributes(el.shadowRoot);
          if (observer) observer.observe(el.shadowRoot, { childList: true, subtree: true, characterData: true });
        }
      });
    }
  }

  // ---------- page-level block ----------

  function pageShouldBlock() {
    if (urlMatches(location.href)) return true;
    // Swipe feeds change the title per video; items are covered one by one instead.
    if (isSnapFeed()) return false;
    if (matches(document.title)) return true;
    const og = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
    if (og && matches(og.getAttribute('content'))) return true;
    return false;
  }

  function pauseAllMedia() {
    document.querySelectorAll('video, audio').forEach((m) => {
      try { m.pause(); m.muted = true; } catch (e) { /* ignore */ }
    });
  }

  let mediaTimer = null;
  function blockPage() {
    if (pageBlocked) return;
    pageBlocked = true;
    document.documentElement.setAttribute('data-gta6-page-blocked', '');
    if (!isTopFrame) {
      // Inside an iframe (e.g. an embedded trailer): just blank it.
      document.documentElement.style.setProperty('visibility', 'hidden', 'important');
      pauseAllMedia();
      mediaTimer = setInterval(pauseAllMedia, 500);
      reportCount();
      return;
    }
    overlayHost = document.createElement('gta6-blocker-overlay');
    const shadow = overlayHost.attachShadow({ mode: 'closed' });
    const iconUrl = ext.runtime.getURL('icons/icon-128.png');
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center;
          justify-content: center; background: #0f0f14; color: #f2f2f5;
          font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .card { max-width: 440px; padding: 32px; text-align: center; }
        img { width: 96px; height: 96px; }
        h1 { font-size: 26px; margin: 16px 0 8px; }
        p { color: #a9a9b8; margin: 0 0 24px; }
        button { font: inherit; padding: 10px 20px; border-radius: 10px; border: 0; cursor: pointer;
          background: #e5484d; color: white; font-weight: 600; }
        button:hover { background: #f2555a; }
      </style>
      <div class="wrap" role="alert">
        <div class="card">
          <img src="${iconUrl}" alt="">
          <h1>GTA content blocked</h1>
          <p>This page is about GTA, so GTA 6 Blocker hid it to keep you spoiler free.</p>
          <button type="button" id="back">Go back</button>
        </div>
      </div>`;
    shadow.getElementById('back').addEventListener('click', () => {
      if (history.length > 1) history.back();
      else location.href = 'about:blank';
    });
    (document.body || document.documentElement).appendChild(overlayHost);
    pauseAllMedia();
    mediaTimer = setInterval(() => {
      pauseAllMedia();
      // Keep the overlay attached if the page rebuilds its DOM.
      if (overlayHost && !overlayHost.isConnected) (document.body || document.documentElement).appendChild(overlayHost);
    }, 500);
    reportCount();
  }

  function unblockPage() {
    if (!pageBlocked) return;
    pageBlocked = false;
    document.documentElement.removeAttribute('data-gta6-page-blocked');
    document.documentElement.style.removeProperty('visibility');
    if (overlayHost) overlayHost.remove();
    overlayHost = null;
    clearInterval(mediaTimer);
    reportCount();
  }

  function checkPage() {
    if (!enabled) return;
    if (pageShouldBlock()) blockPage();
    else if (pageBlocked) {
      unblockPage();
      scan(document.documentElement);
    }
  }

  function clearMarks() {
    document.querySelectorAll('[data-gta6-blocked]').forEach((el) => el.removeAttribute('data-gta6-blocked'));
    document.querySelectorAll('[data-gta6-covered]').forEach((el) => el.removeAttribute('data-gta6-covered'));
  }

  function unhideAll() {
    clearMarks();
    unblockPage();
    blockedCount = 0;
    reportCount();
  }

  // ---------- observation ----------

  function flush() {
    scheduled = false;
    if (location.href !== lastUrl || document.title !== lastTitle) {
      lastUrl = location.href;
      lastTitle = document.title;
      checkPage();
    }
    if (pageBlocked) { pendingRoots.clear(); return; }
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    for (const r of roots) {
      if (r.isConnected !== false) scan(r);
    }
  }

  function schedule(root) {
    pendingRoots.add(root);
    if (scheduled) return;
    scheduled = true;
    (window.requestIdleCallback || window.requestAnimationFrame)(flush, { timeout: 150 });
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach((n) => {
            if (n.nodeType === 1 && n !== overlayHost) schedule(n);
            else if (n.nodeType === 3 && n.parentElement) schedule(n.parentElement);
          });
          if (m.target.nodeName === 'TITLE' || m.target.nodeName === 'HEAD') schedule(document.documentElement);
        } else if (m.type === 'characterData' && m.target.parentElement) {
          schedule(m.target.parentElement);
        } else if (m.type === 'attributes' && m.target.nodeType === 1) {
          schedule(m.target);
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'alt', 'aria-label', 'href']
    });
    // SPA navigations that don't touch the DOM much.
    window.addEventListener('popstate', () => schedule(document.documentElement));
    window.addEventListener('yt-navigate-finish', () => schedule(document.documentElement));
  }

  function stopObserver() {
    if (observer) observer.disconnect();
    observer = null;
  }

  // ---------- settings ----------

  async function apply() {
    const s = await getSettings();
    const allowed = isAllowlisted(location.hostname, s.allowlist);
    const wasEnabled = enabled;
    enabled = !!s.enabled && !allowed;
    matcher = buildMatcher(s.keywords);

    if (!enabled) {
      stopObserver();
      if (wasEnabled) unhideAll();
      return;
    }
    // Keyword list may have changed: re-evaluate from scratch.
    if (wasEnabled) {
      clearMarks();
      blockedCount = 0;
      unblockPage();
    }
    lastUrl = location.href;
    lastTitle = document.title;
    checkPage();
    if (!pageBlocked) scan(document.documentElement);
    startObserver();
  }

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled || changes.keywords || changes.allowlist) apply();
  });

  ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'gta6:getCount') {
      sendResponse({ count: blockedCount, pageBlocked });
    }
  });

  apply();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => schedule(document.documentElement), { once: true });
  }
})();
