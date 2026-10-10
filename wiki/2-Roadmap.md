# 2. Roadmap

- [x] v0.1 — sender aggregation table, mbox import + Gmail metadata connect — #1
- [x] v0.2 — force-directed bubble graph — #2
- [x] v0.3 — unsubscribe links, Gmail search for bulk archive, cleanup list + CSV — #3 (released as v0.3.0)
- [x] v0.4 — live physics map, any provider (IMAP relay + Outlook sign-in), insights, Gmail/Sieve filter exports, map PNG — #4, #7–#10 (released as v0.4.0)

- [x] v0.6 — premium design with company logos, colour classes and filters, free placement, group selection — #12–#14 (released as v0.6.0)

## Next
- Optional in-app bulk archive (needs the restricted `gmail.modify` scope) and RFC 8058 one-click POST (blocked by CORS in browsers, so it needs a relay).

## Notes for contributors / LLM agents
- Keep it client-side and request the narrowest scope.
- Do not add map colours beyond the three categories.
