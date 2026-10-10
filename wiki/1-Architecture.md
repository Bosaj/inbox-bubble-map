# 1. Architecture

Client-side React + Vite app. The only server code is a stateless IMAP header relay (`api/imap.ts`, a Vercel Function) used for app-password providers. No analytics, and nothing is persisted beyond the theme setting.

## Data flow
1. **Import.** One of: a `.mbox`/`.eml` file streamed in a Web Worker; the Gmail API (`gmail.metadata`); Microsoft Graph (`Mail.ReadBasic`, MSAL v5 popup with the `redirect.html` bridge); or the `/api/imap` relay for app-password providers.
2. **Headers to `MessageMeta`.** From, Date, Subject, List-Unsubscribe(-Post), List-Id, Precedence and Gmail labels (`headers.ts`).
3. **Aggregate.** Messages are grouped by company (root domain) or by address. Each sender gets a count, unread count, first/last seen, a category (bulk, automated or people), unsubscribe targets and recent subjects (`aggregate.ts`).
4. **Layout.** A deterministic d3-force simulation runs synchronously (`layout.ts`). The radial force uses log(days since last message), collision keeps bubbles apart and a weak sector force groups the categories.
5. **UI.** Live physics map (continuous d3-force + drift, DOM updates per tick, drag & fling, pop animation), side panel with insights and activity chart, sortable table, cleanup list, exports (CSV, Gmail filters, Sieve, PNG).

## Display
- Colour modes: type (3 validated categorical hues), unread rate and last seen (single-hue sequential ramps), can-unsubscribe (2 classes).
- Layouts: Orbit (radial recency), Clusters (anchors per type), Free (collide + drift only). Dragged bubbles stay pinned; groups move together.
- Logos come through `/api/logo`, a same-origin proxy with fixed sources and a 30-day CDN cache.

## Privacy model
- Message bodies are skipped during parsing, never stored.
- The IMAP relay is stateless: port 993/TLS only, SSRF guard with pinned DNS result, same-origin, rate limit, failed-login lockout, never logs credentials or mail.
- The Gmail token lives in memory only. Requests go straight from the browser to `gmail.googleapis.com`.
- Unsubscribe URLs come from the emails and are only opened on click. Only `https:` and `mailto:` links are accepted.
- Vercel serves a strict CSP: same-origin scripts, plus Google Identity Services only when Gmail connect is used.

## Why three colours
The bubble map is an all-pairs chart (any bubble can sit next to any other). Validation showed three hues are the most that stay distinguishable for colour-blind readers too. Filters, labels and the table view carry the rest.
