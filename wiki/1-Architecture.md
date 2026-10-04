# 1. Architecture

1. OAuth to Gmail (read-only) → fetch message metadata only (From, List-Unsubscribe).
2. Aggregate by sender/domain → counts, last-seen, unsubscribe link present?
3. Render a force-directed graph: central "you" node, sender bubbles sized by volume.
4. Click a bubble → unsubscribe (via List-Unsubscribe) or bulk-archive/delete.

## Proposed stack
- Gmail API (OAuth, read-only scope first)
- Parse From + List-Unsubscribe headers; aggregate by sender/domain
- Visualization: react-force-graph / d3-force
- Privacy: process locally in the browser, store nothing server-side

## Open bases to fork
- **(none for the graph)** — Unsubscribe tools are closed-source; build the viz yourself on the Gmail API.
