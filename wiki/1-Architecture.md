# 1. Architecture

Static, client-side React + Vite app. No backend, analytics or persistence beyond the theme setting.

## Data flow
1. **Import.** Either a `.mbox`/`.eml` file streamed in a Web Worker (`parse.worker.ts` → `MboxParser`), or the optional Gmail API (`gmail.ts`, `gmail.metadata` scope).
2. **Headers to `MessageMeta`.** From, Date, Subject, List-Unsubscribe(-Post), List-Id, Precedence and Gmail labels (`headers.ts`).
3. **Aggregate.** Messages are grouped by company (root domain) or by address. Each sender gets a count, unread count, first/last seen, a category (bulk, automated or people), unsubscribe targets and recent subjects (`aggregate.ts`).
4. **Layout.** A deterministic d3-force simulation runs synchronously (`layout.ts`). The radial force uses log(days since last message), collision keeps bubbles apart and a weak sector force groups the categories.
5. **UI.** SVG map with d3-zoom, side panel, sortable table, cleanup list and CSV export.

## Privacy model
- Message bodies are skipped during parsing, never stored.
- The Gmail token lives in memory only. Requests go straight from the browser to `gmail.googleapis.com`.
- Unsubscribe URLs come from the emails and are only opened on click. Only `https:` and `mailto:` links are accepted.
- Vercel serves a strict CSP: same-origin scripts, plus Google Identity Services only when Gmail connect is used.

## Why three colours
The bubble map is an all-pairs chart (any bubble can sit next to any other). Validation showed three hues are the most that stay distinguishable for colour-blind readers too. Filters, labels and the table view carry the rest.
