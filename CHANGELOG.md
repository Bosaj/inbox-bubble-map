# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/), versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.10.1] - 2026-10-17
### Fixed
- The latin Geist and Instrument Serif fonts are preloaded (a small build plugin adds <link rel=preload> tags for the hashed files), so the start screen's headline no longer reflows when the web font arrives (mobile CLS 0.19).

## [0.10.0] - 2026-10-17
### Added
- Installable app (PWA): web manifest, icons (any + maskable + Apple touch), and a service worker that keeps the app shell available offline. Mail, sign-in and the relays always go to the network (`/api/*` and `redirect.html` are excluded from the navigation fallback). An *Install app* button appears when the browser offers it (Chrome, Edge, Android); iPhone users can use Share → Add to Home Screen. (#31)
- Listen to an email: the reader's *Listen* button reads the subject and text aloud (HTML, styles and links stripped). The voice is chosen from the email's own language (Arabic script, otherwise French vs English by common words), with a Stop button. In Arabic, French and English. (#31)

## [0.9.0] - 2026-10-17
### Added
- Whole mailbox, not just the newest 5,000: after the first 2,000 messages appear, the rest loads in the background (every message id is listed, only missing ones are fetched) with a live counter and time estimate. Progress is cached as it goes and resumes on the next visit. *Load all my mail* in the account menu until it is complete. (#29)
- Outlook stays signed in: MSAL keeps its cache in localStorage, the map is cached on the device like Gmail, opens instantly and refreshes in the background; *Log out* clears the Microsoft session and the cache. (#29)
- Microsoft sign-in is on: an Entra ID app in the owner's personal directory (personal and work accounts, single-page app redirects, delegated `Mail.ReadWrite`), with `VITE_MS_CLIENT_ID` set in Vercel. (#22)

### Changed
- The connect dialog only asks how many messages to read for app-password (IMAP) accounts; Google and Microsoft load everything.

## [0.8.0] - 2026-10-11
### Added
- Stay signed in: Gmail sign-in through `/api/google/login` → `/callback` (OAuth code flow with PKCE). The refresh token is sealed (AES-256-GCM, HKDF key) into an httpOnly, Secure, SameSite=Lax cookie; `/api/google/session` hands out short-lived access tokens and logs out (revokes at Google). Nothing is stored on the server. Falls back to the popup sign-in when `GOOGLE_CLIENT_SECRET` is not set. (#27)
- On-device cache (IndexedDB) of the signed-in mailbox: the map opens instantly on return. (#27)
- Incremental sync with the Gmail History API: only new mail, read-state changes, trash and spam since the last visit; a full rebuild when the checkpoint is too old. (#27)
- Account menu: who is signed in, last sync, *Sync now*, *Load 2,000 older messages*, *Log out* (revokes access and erases the cache). A "Welcome back" card resumes a cached account. All in Arabic, French and English. (#27)

### Changed
- The Gmail map only counts received mail (`-in:sent -in:draft -in:chats`), so your own address no longer shows up as a sender.

## [0.7.2] - 2026-10-11
### Fixed
- Opening a sender while a Gmail import was still streaming hit `403 rateLimitExceeded`: the import and the sender panel had separate throttles, so together they went over Gmail's per-user limit. They now share one throttle; clicks jump the queue and the background import slows to make room. The import starts at 30 reads/s and slows down once per burst of rate-limit answers instead of once per failed request. (#25)

## [0.7.1] - 2026-10-11
### Fixed
- Gmail import no longer fails on large mailboxes. Gmail answers `403 rateLimitExceeded` once an app reads more than about 50 messages a second; requests are now paced (40/s), every worker pauses and slows down on a rate-limit answer, and a single message that keeps failing is skipped instead of aborting the import. (#23)
- The map opens after the first ~200 Gmail messages and keeps growing while the rest load, with a live counter in the header. (#23)
- The CSP now allows small font files that the build inlines as `data:` URIs (Arabic subsets were blocked).

## [0.7.0] - 2026-10-11
### Added
- Read mail inside the app: the sender panel lists that sender's newest messages, and a reader shows them in a sandboxed iframe with its own CSP, so remote images, fonts, forms and scripts are blocked. Works for Gmail, Outlook, IMAP and the demo inbox. (#17)
- Act on mail: mark read/unread, archive, trash and report spam per message, per sender or for a whole selection, with confirmations and progress. Emptied senders pop off the map. Gmail uses `batchModify` and `messages.trash`, Outlook uses JSON `$batch` moves, IMAP uses flags and `MOVE` to the special-use Archive / Trash / Junk folders. (#18)
- `POST /api/unsubscribe`: RFC 8058 one-click unsubscribe relay (https on 443 only, DNS-checked and pinned public address, no redirects, rate-limited). Gmail can send the `mailto:` unsubscribe email itself. (#5)
- IMAP relay actions `list`, `ids`, `body` (parsed with postal-mime) and `act`, with separate rate limits for reads and actions. (#18)
- Arabic (right to left, IBM Plex Sans Arabic) and French interface with a language switcher, local number/date formats and error messages mapped from relay codes. (#19)
- Google sign-in switched on: `VITE_GOOGLE_CLIENT_ID` set in Vercel for a Testing-mode Google Auth Platform app. (#20)

### Changed
- Scopes are now `gmail.modify` and `Mail.ReadWrite` (needed for the actions above). Bodies are fetched only when a message is opened.

## [0.6.0] - 2026-10-10
### Added
- Premium redesign: Geist and Instrument Serif type, aurora background, glass panels, glossy 3D bubbles with depth, and company logos on white plates with a monogram fallback. (#12)
- `/api/logo`: same-origin icon proxy. It uses fixed sources (DuckDuckGo, Google), checks type and size, caches for 30 days at the CDN, and never connects to sender hosts. Shared network guards moved to `api/_lib/net.ts`. (#12)
- Colour classes (type, unread rate, last seen, can unsubscribe) with legends, and a filters panel (unsubscribable, unread %, volume, recency, Gmail tab). (#13)
- Free placement: drag to pin anywhere, double-click to release, unpin all; Orbit / Clusters / Free layouts. Multi-select by Shift-click, lasso or presets; group drag; group bar to add to cleanup or pop all. (#14)

### Changed
- The PNG export bakes in computed colours, so colour modes and gradients render correctly in the image.

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

[Unreleased]: https://github.com/Bosaj/inbox-bubble-map/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/Bosaj/inbox-bubble-map/releases/tag/v0.6.0
[0.4.0]: https://github.com/Bosaj/inbox-bubble-map/releases/tag/v0.4.0
[0.3.0]: https://github.com/Bosaj/inbox-bubble-map/releases/tag/v0.3.0
