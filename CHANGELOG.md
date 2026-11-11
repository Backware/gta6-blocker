# Changelog

## 1.1.0 (2026-11-11)

- README: screenshots, "how it works", AI-generated notice and a full guide to signing for Safari (free Apple ID, Developer ID, App Store).
- Demo pages and a script to regenerate the screenshots (`npm run screenshots`).

- Block all Grand Theft Auto content, not just GTA 6: `GTA`, `GTA 5`, `GTA Online`, `Grand Theft Auto`, `Vice City`, characters and places.
- Hashtags match by prefix (`#gtaonline`, `#gta6leaks`, `#vicecityvibes`), including links to hashtag pages.
- Instagram captions, hashtags, grid tiles and comments.
- YouTube Shorts player, Instagram Reels, TikTok and Facebook Reels: GTA videos are covered and muted, and the feed keeps working.
- Network rules now catch any GTA search, GTA pages on rockstargames.com and common GTA fan sites.
- Test checks that every network rule regex is accepted by Chrome.

## 1.0.0 (2026-11-11)

- First release: page, search, video and social post blocking for GTA 6 / Grand Theft Auto VI.
- Network rules for GTA 6 searches, `rockstargames.com/VI` and embedded GTA 6 iframes.
- Popup with on/off switch, per-site switch and counters.
- Settings page with editable keywords and allowlist.
- Chrome (Manifest V3) and Safari (via `safari-web-extension-converter`) support.
