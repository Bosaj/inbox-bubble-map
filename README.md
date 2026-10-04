# Inbox Bubble Map

> See your email as a graph: you in the center, every newsletter and service that emails you as a connected bubble — then clean up.

**Status:** pre-alpha scaffold (no code yet). **Feasibility rating:** 5/10 — bulk-unsubscribe is solved; the graph visualization is the gap.
**Author:** Oussama EL HADJI. Part of the Bosaj ideas portfolio (sibling repo: `dual_portfolio_hub`).

---

## Problem

People lose track of which newsletters and services email them. A node/bubble graph of senders makes the mess visible and makes cleanup intuitive.

## Why build it (gap analysis)

Bulk-unsubscribe is a crowded space (Clean Email, Leave Me Alone, Unroll.me, Gmail "Manage subscriptions"). The specific force-directed bubble-graph visualization is uncommon and is the UX differentiator.

## Prior art & open bases to fork

- **(none for the graph)** — Unsubscribe tools are closed-source; build the viz yourself on the Gmail API.

## Proposed architecture

1. OAuth to Gmail (read-only) → fetch message metadata only (From, List-Unsubscribe).
2. Aggregate by sender/domain → counts, last-seen, unsubscribe link present?
3. Render a force-directed graph: central "you" node, sender bubbles sized by volume.
4. Click a bubble → unsubscribe (via List-Unsubscribe) or bulk-archive/delete.

## Tech stack (proposed)

- Gmail API (OAuth, read-only scope first)
- Parse From + List-Unsubscribe headers; aggregate by sender/domain
- Visualization: react-force-graph / d3-force
- Privacy: process locally in the browser, store nothing server-side

## Roadmap

- v0.1 — Gmail OAuth + sender aggregation table.
- v0.2 — force-directed bubble graph.
- v0.3 — one-click unsubscribe / bulk actions.
- v0.4 — other providers (generic IMAP).

---

## For LLM agents & contributors continuing this project

This repo is a **scaffold**: README + standard files, no implementation yet. If you are an AI agent asked to "continue developing", read this section first.

- Request the narrowest Gmail scope that works (metadata/readonly) and never store message bodies.
- Do all aggregation client-side; if a backend is ever added, keep tokens server-side and never log them.
- The graph is the product — invest in the react-force-graph interaction (zoom, cluster by domain, filter by volume).

**Ground rules:** keep this README in sync with reality as you build; prefer forking/reusing the bases above over greenfield code; write tests for anything correctness-critical; never commit secrets (see `.gitignore`); follow Conventional Commits (see `CONTRIBUTING.md`).

## Getting started

```bash
# nothing to run yet — this is a scaffold.
# npm install && npm run dev   # once code lands
```

## License

[MIT](LICENSE) — © 2026 Oussama EL HADJI
