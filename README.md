# Inbox Bubble Map

> See your email as a living map: you in the centre, every newsletter, service and person that writes to you as a floating bubble. Spot the lists you never open, unsubscribe, and pop them off the map.

[![CI](https://github.com/Bosaj/inbox-bubble-map/actions/workflows/ci.yml/badge.svg)](https://github.com/Bosaj/inbox-bubble-map/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Privacy](https://img.shields.io/badge/reads-headers%20only-4a3aa7)

**Live:** https://inbox-bubble-map.vercel.app · **Status:** v0.4 — live physics map; Gmail, Outlook, Yahoo, iCloud and any IMAP provider; insights, filter exports.
**Author:** Oussama EL HADJI. Part of the Bosaj ideas portfolio (sibling repo: `dual_portfolio_hub`).

<p align="center"><img src="docs/map-light.webp" alt="Bubble map with a sender panel: unsubscribe actions and a 12-month activity chart" width="820" /></p>
<p align="center">
  <img src="docs/map-dark.webp" alt="Dark theme, last 30 days, with inbox insights" width="520" />
  &nbsp;
  <img src="docs/connect.webp" alt="Connect Yahoo Mail with an app password" width="300" />
</p>

---

## Problem

People lose track of which newsletters and services email them. Bulk-unsubscribe tools show long lists. A living bubble map makes the mess visible at a glance, and popping a bubble when you unsubscribe makes cleaning up feel good.

## How to read the map

| Encoding | Meaning |
|---|---|
| **Bubble size** | number of messages from that sender (area ∝ count) |
| **Distance from "You"** | how long ago they last wrote (log scale; rings at 7 days, 30 days, 1 year) |
| **Colour** | 🟠 newsletters & promos (has `List-Unsubscribe` / `List-Id` / bulk) · 🔵 automated (no-reply, alerts, receipts) · 🟢 people |

Only three colours are used on purpose. In an all-pairs chart like this, three hues are the most that stay distinguishable for every reader, colour-blind included (validated with OKLab ΔE checks). The legend chips double as filters, every bubble has a label or tooltip, and a full **table view** is one click away.

## Connect any inbox

| Provider | How | What is read |
|---|---|---|
| **Gmail** | Google sign-in (`gmail.metadata`) or an app password | headers + labels |
| **Outlook / Hotmail / Microsoft 365** | Microsoft sign-in (`Mail.ReadBasic`) | headers, read state, Focused/Other |
| **Yahoo, iCloud, AOL, GMX, Zoho, Fastmail, any IMAP** | app password through the relay | headers + read flag |
| **Any export** | drop a `.mbox` (Google Takeout, Thunderbird, Apple Mail) or `.eml` | headers |
| **Demo** | fictional inbox | — |

Outlook.com switched off IMAP app passwords in September 2024, which is why Outlook uses Microsoft sign-in.

## Features

- **Bubbles that move.** A live d3-force simulation with a gentle idle drift. Drag and fling any bubble and the others make room. Bubbles burst out of "You" on load and pop with particles when you clean a sender up (with undo). Motion pauses in background tabs and respects `prefers-reduced-motion`.
- **Time range.** 30 days, 90 days, 1 year or everything, measured from your newest message.
- **Insights.** Share of mail from lists, list emails per week, senders you never open, top-5 concentration, and how many emails a year your cleanup list will save you.
- **Sender detail.** Messages, unread %, last/first seen, a 12-month activity chart, recent subjects and addresses.
- **Clean up.** *Unsubscribe* opens the `List-Unsubscribe` page or a pre-filled email. *Find in Gmail* searches `from:` for bulk archive. *Top cleanup picks* ranks by volume × unread × unsubscribable.
- **Exports.** CSV, **Gmail filters** (`.xml`: skip inbox and mark read), **Sieve** rules (Fastmail, Proton, Posteo, cPanel…), and the **map as a PNG**.
- Search, grouping by company or address, zoom/pan, light/dark/system theme, responsive layout, strict CSP.

## Privacy

- Only headers are read: From, Date, Subject, List-Unsubscribe(-Post), List-Id, Precedence and read state. Never bodies or attachments.
- Files, Google sign-in and Microsoft sign-in run **entirely in your browser**. Tokens stay in the tab.
- Browsers can't open IMAP connections, so app-password providers go through `/api/imap`, a Vercel Function. Per request it connects over TLS, reads the newest N header blocks, returns them and disconnects. It **never stores or logs** credentials or mail.
- **Relay hardening.** Port 993/TLS only; public hostnames only (DNS checked, private ranges refused, connection pinned to the checked address); same-origin requests only; 4 KB body limit; per-IP rate limit and a lockout after failed logins; `Cache-Control: no-store`.
- No analytics, no cookies. Nothing is saved when you close the tab (only the theme choice).
- Unsubscribe links come from the emails and open only when you click them. Only `https:` and `mailto:` links are accepted.

## Architecture

```
api/imap.ts             IMAP header relay (Vercel Function): validation, SSRF guard, rate limit, imapflow
src/lib/headers.ts      RFC 2047 decoding, From / List-Unsubscribe / Date parsing
src/lib/mbox.ts         streaming mbox reader (header blocks only, folding, CRLF)
src/lib/parse.worker.ts Web Worker: File.stream() → parser, progress events
src/lib/gmail.ts        Gmail API client (GIS token, paging, retry, concurrency)
src/lib/outlook.ts      Microsoft Graph client (MSAL v5 popup, paging, header fallback)
src/lib/providers.ts    provider presets + relay client
src/lib/aggregate.ts    grouping, categories, months, insights, CSV / Gmail filters / Sieve
src/lib/layout.ts       scales + shared d3-force setup (static layout for tests and first frame)
src/components/         BubbleMap (live physics), ConnectDialog, Insights, SidePanel, SenderTable…
```

34 Vitest tests cover header decoding, chunk-independent mbox parsing, aggregation and insights, exports (Gmail XML parses, Sieve escaping), the layout, the Gmail and Graph clients (paging, retries, header fallback), and the relay (validation, SSRF, rate limit, origin check, no credential echo). The relay's imapflow path was also run end-to-end against a GreenMail IMAP server.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173 (the dev server also serves /api/imap)
npm test
npm run build
```

Optional sign-ins: copy `.env.example` to `.env` and set `VITE_GOOGLE_CLIENT_ID` and/or `VITE_MS_CLIENT_ID`. Every step is in that file. Without them, Gmail still works through an app password, and Outlook users are guided to an `.mbox` export.

## Roadmap

- [x] v0.1 — sender aggregation table, mbox import + Gmail metadata connect — [#1](https://github.com/Bosaj/inbox-bubble-map/issues/1)
- [x] v0.2 — force-directed bubble graph — [#2](https://github.com/Bosaj/inbox-bubble-map/issues/2)
- [x] v0.3 — unsubscribe links, Gmail search for bulk archive, cleanup list + CSV — [#3](https://github.com/Bosaj/inbox-bubble-map/issues/3)
- [x] v0.4 — live physics, any provider (IMAP relay + Outlook), insights, filter exports — [#4](https://github.com/Bosaj/inbox-bubble-map/issues/4), [#7](https://github.com/Bosaj/inbox-bubble-map/issues/7)–[#10](https://github.com/Bosaj/inbox-bubble-map/issues/10)
- [ ] Next — one-click RFC 8058 unsubscribe relay and optional in-app bulk archive — [#5](https://github.com/Bosaj/inbox-bubble-map/issues/5)

---

## For LLM agents & contributors continuing this project

- Keep the client-side paths client-side. The relay must stay stateless: no storage, no logs of credentials or mail, headers only.
- Request the narrowest scopes (`gmail.metadata`, `Mail.ReadBasic`). Never fetch or store bodies.
- Don't add colours to the map: three categories are the validated maximum for this chart form. Use filters, labels or the table instead.
- Parser or relay changes need tests (`src/lib/lib.test.ts`, `src/lib/v04.test.ts`).

**Ground rules:** keep this README in sync with reality; write tests for anything correctness-critical; never commit secrets; follow Conventional Commits (see `CONTRIBUTING.md`).

## License

[MIT](LICENSE) — © 2026 Oussama EL HADJI
