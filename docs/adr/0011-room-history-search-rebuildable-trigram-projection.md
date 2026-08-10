# Room History Search is a rebuildable trigram projection subordinate to chat availability

Room History Search is a per-room projection of persistent text Chat Messages, not a second source of truth. Each room
Durable Object's SQLite database owns a contentless FTS5 table with the `trigram` tokenizer. The indexed value is folded
only for ASCII case comparison; non-ASCII characters remain as written. Queries shorter than three characters are rejected,
because a trigram index cannot provide a meaningful substring search below that bound.

The projection is rebuilt from room history when needed. A Durable Object Alarm advances a high-water cursor through
historical messages in bounded batches, so a wake-up, failure, or retry can resume rather than restarting an unbounded
operation. Until the complete retained history is ready, search reports `Preparing` and returns no partial results. An
index-maintenance failure does not block Message Acceptance: the room changes search readiness to `Search Unavailable`,
and a retry can rebuild the projection.

## Why this shape

- **Full-table scan.** Rejected: it makes every query pay for the room's entire retained history, produces poor tail latency,
  and competes with the Durable Object's chat work as rooms grow.
- **Ordinary token FTS.** Rejected: Room History Search matches continuous substrings, including inside words, while token
  search is a different boundary-based behavior. Trigram indexing also makes the three-character minimum explicit.
- **Cross-room index.** Rejected: room history is owned by the room object, and a global index would add cross-object
  consistency, authorization, deletion, and rebuild coordination without improving the current-room use case.
- **Block chat until the index is ready.** Rejected: search is an optimization over accepted history; delaying Message
  Acceptance to protect a derived index violates the primary availability guarantee.

A local 100,000-message prototype is feasibility evidence, not a production capacity promise: it built in about 0.65s,
used about 26.7MB of additional storage, and returned the first page in a 9-10ms median. The release SLO is a first-page
P95 of <=500ms and subsequent-page latency of <=300ms, while search indexing and querying must not materially affect chat
acceptance or delivery.

Search POST bodies, query strings, and result snapshots are not persisted. A submitted query gets a stable, page-local
snapshot bounded by the room history visible at submission time; later messages do not enter it, and refresh or leaving the
room discards it. Opening a match uses a separate historical context window around the older message, preserving the
conversation without merging it into the live view.

The trade-off is extra per-room SQLite storage and Alarm work, plus an explicit period in which search is unavailable or
preparing. In return, current-room substring search has predictable pagination and isolation, can be rebuilt from the
authoritative history, and cannot turn an index defect into lost or rejected chat messages.
