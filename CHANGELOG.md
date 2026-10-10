# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/Bosaj/inbox-bubble-map/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Bosaj/inbox-bubble-map/releases/tag/v0.3.0
