# 2. Roadmap

- [x] v0.1 — sender aggregation table, mbox import + Gmail metadata connect — #1
- [x] v0.2 — force-directed bubble graph — #2
- [x] v0.3 — unsubscribe links, Gmail search for bulk archive, cleanup list + CSV — #3 (released as v0.3.0)
- [ ] v0.4 — other providers (generic IMAP) — #4

## Next
- Generic IMAP needs a local bridge or desktop wrapper, because browsers cannot open IMAP sockets.
- Optional in-app bulk archive (needs the restricted `gmail.modify` scope) and RFC 8058 one-click POST (blocked by CORS in browsers, so it needs a relay).

## Notes for contributors / LLM agents
- Keep it client-side and request the narrowest scope.
- Do not add map colours beyond the three categories.
