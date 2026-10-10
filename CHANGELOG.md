# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-10-10
### Added
- Live physics map: a continuous d3-force simulation with idle drift, rendered by direct DOM updates. Drag and fling bubbles, burst-out entrance, hover wobble, and a pop-with-particles animation (with undo) when a sender is cleaned. Pauses in background tabs and respects reduced motion. (#7)
- Connect any provider. Microsoft sign-in for Outlook / Hotmail / Microsoft 365 (MSAL v5 popup, Graph Mail.ReadBasic, paging, header fallback). (#8) An IMAP header relay (`api/imap.ts`) with presets for Gmail, Yahoo, iCloud, AOL, GMX, Zoho, Fastmail and custom servers, plus per-provider app-password steps. (#4)
- Relay hardening: TLS on port 993 only, a public-DNS SSRF guard with a pinned address, same-origin check, body limit, per-IP rate limit and failed-login lockout. No storage or logging.
- Time range filter (30 days / 90 days / 1 year / all), insight tiles, and a 12-month activity chart per sender. (#9)
- Export menu: CSV, Gmail filters (.xml), Sieve rules (.sieve) and the map as a PNG. (#10)

### Changed
- Import screen redesigned around provider tiles; the privacy notice now describes the relay.
- The map toolbar is a single scrollable row on phones.

## [0.3.0] - 2026-10-10
First working release: roadmap milestones v0.1–v0.3.

### Added
- Streaming Google Takeout `.mbox` and `.eml` import in a Web Worker. It reads header blocks only, handles folding, RFC 2047 encoded words and CRLF, and uses constant memory. (#1)
- Optional Gmail import using the `gmail.metadata` scope: Google Identity Services token, paging, 429/5xx retry with backoff, bounded concurrency. Turned on with `VITE_GOOGLE_CLIENT_ID`. (#1)
- Sender aggregation by company (mail subdomains merged) or by address. Senders are sorted into three validated categories: newsletters & promos, automated, people. Sortable table view. (#1)
- Deterministic d3-force bubble map: area ∝ messages, distance ∝ time since last message (log scale, labelled rings), category sectors. Includes zoom/pan, search highlight, top-N cap, tooltips and pop-in animation. (#2)
- Sender detail panel. Unsubscribe actions use `List-Unsubscribe` (https or mailto), "Find in Gmail" opens a search for bulk archive, and "Top cleanup picks" ranks senders by volume × unread × unsubscribable. Cleanup list with CSV export. (#3)
- Fictional demo inbox; light/dark/system theme; responsive layout.
- CI (type-check, 19 tests, build) and Vercel config with a strict Content-Security-Policy.

### Changed
- Replaced the local Python prototype with the client-side web app described in the architecture.

## [0.0.0] - 2026-10-04
### Added
- Initial repository scaffold: README (with architecture, roadmap and an LLM-handoff section), LICENSE, .gitignore, CONTRIBUTING, issue/PR templates, and wiki pages.

[Unreleased]: https://github.com/Bosaj/inbox-bubble-map/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Bosaj/inbox-bubble-map/releases/tag/v0.4.0
[0.3.0]: https://github.com/Bosaj/inbox-bubble-map/releases/tag/v0.3.0
