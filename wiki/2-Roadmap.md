# 2. Roadmap

- v0.1 — Gmail OAuth + sender aggregation table.
- v0.2 — force-directed bubble graph.
- v0.3 — one-click unsubscribe / bulk actions.
- v0.4 — other providers (generic IMAP).

## Notes for contributors / LLM agents
- Request the narrowest Gmail scope that works (metadata/readonly) and never store message bodies.
- Do all aggregation client-side; if a backend is ever added, keep tokens server-side and never log them.
- The graph is the product — invest in the react-force-graph interaction (zoom, cluster by domain, filter by volume).
