# Contributing to GTA 6 Blocker

Thanks for helping keep the internet GTA 6 free (for those who want it).

## Ways to help

- **Something slipped through?** Open an issue with the URL and a short description or screenshot of what wasn't hidden.
- **Too much hidden?** Open an issue with the page and the keyword that caused it.
- **New site support:** add the site's "card" selector (the element that wraps one result, video or post) to `CARD_SELECTORS` in `src/content.js`.
- **Keywords:** propose changes to `DEFAULT_KEYWORDS` in `src/shared.js`. Keep them specific to GTA 6 so other content isn't hidden.

## Development setup

1. Fork and clone the repo.
2. Load `src/` as an unpacked extension (see the README).
3. Edit, then press reload on the extension card in `chrome://extensions`.

There is no bundler or build step on purpose: the code in `src/` is exactly what ships.

## Before you open a pull request

- Run `npm test` and make sure all checks pass. Add a case to `test/fixture.html` for new behaviour.
- Test in Chrome. If you can, also test in Safari via `scripts/build-safari.sh`.
- Keep it dependency-free and compatible with both browsers: use the `ext` handle from `shared.js` (works as `browser` in Safari and `chrome` in Chromium), and only Manifest V3 APIs Safari supports.
- No analytics, remote code or network requests. Privacy is a feature.

## Releasing

Releases are created automatically by `.github/workflows/release.yml`:

1. Bump `version` in `src/manifest.json` **and** `package.json` (they must match).
2. Add a `## <version> (<date>)` section at the top of `CHANGELOG.md`.
3. Merge to `main`.

The workflow runs the tests, builds `gta6-blocker-chrome-<version>.zip` and publishes the GitHub release `v<version>` with the changelog section as notes. Pushes that don't change the version do nothing. Pull requests run the tests via `.github/workflows/test.yml`.

The Safari app is not built in CI, because it has to be signed on a Mac. Build it locally and attach it to the release if you want to ship it.

## Code style

- Plain modern JavaScript, 2-space indent, single quotes, semicolons.
- Small, commented functions. Explain *why* a selector or rule exists if it isn't obvious.

## Commit messages

Short imperative subject line, e.g. `Hide GTA 6 cards on Twitch directory`.

## Contact

For anything that doesn't fit an issue, reach out via [backware.cc](https://backware.cc).

## Code of conduct

Be kind and constructive. Harassment of any kind isn't tolerated.
