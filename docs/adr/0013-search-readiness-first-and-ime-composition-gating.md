# Search readiness is checked before consuming the rate budget, and the search dialog gates IME composition

Room History Search has two small frictions this ADR removes: every query cost two round-trips, and the dialog fired searches mid-IME-composition.

## The redundant `status` probe

`performSearch` (`client/src/components/room-search-dialog.tsx`) historically issued `{action:"status"}` before `{action:"search"}`. The probe existed for one reason: the server (`server/src/do/room.ts:561-568`) consumed the per-user search rate budget _before_ checking readiness. Probing `status` first let the client bail cheaply while a room was Preparing or Search Unavailable without spending the user's budget — and `status` itself early-returns at `room.ts:552` without touching the budget. The integration test at `server/test/search.integration.ts:466-482` locks this behavior in: five `search` calls exhaust the budget, then `status` still succeeds and a sixth `search` returns `rateLimited: true`.

The defining decision is to **reorder the server**: in `Room.search`, read `readSearchState()` and return `{readiness}` _before_ calling `consumeSearchRateLimit`. Only an action that actually runs the FTS query consumes the Room History Search Rate Budget; `status` and `retry` continue to consume nothing. With readiness checked first, the client no longer needs to probe before searching and `performSearch` becomes one POST instead of two.

## Why not other shapes

- **Merge `retry` + `search` into one action.** Rejected — `retry` is a write (it triggers `beginSearchRebuild`) and `search` is a read. Collapsing them obscures the read/write boundary and races the rebuild, which may not flip the room to `ready` on the same call.
- **New `searchOrStatus` action that conditionally searches.** Rejected — it discriminates server-side with no benefit over reordering the readiness check, and grows the request schema for no semantic gain.
- **Client-side readiness cache (probe `status` once when the dialog opens, trust it locally).** Rejected — long-lived dialog sessions would serve stale readiness after a server-side transition to Search Unavailable, and the cache would need invalidation logic more complex than the reorder it tries to avoid.

## Preparing-phase polling stays

The dialog's preparing-phase poll (`room-search-dialog.tsx:380-411`) also uses `{action:"status"}` standalone, on a 2-second interval while `phase === "preparing"`. It is **untouched** by this decision:

- It already stops itself on `ready` — the `setPhase("initial")` transition re-runs the effect, which early-returns on `phase !== "preparing"` and clears the interval.
- It is not on the rate-limit path (`status` never consumes the budget).
- It has no query yet; `status` is exactly the right semantic for "is the room searchable yet."

Once the room is `ready`, the only way the client learns about a regression to Search Unavailable is the next `search` response (`room.ts:566-568` returns `{readiness:"unavailable"}`). The user then clicks retry, the server rebuilds and returns `preparing`, and the polling effect restarts. No additional proactive probing is needed.

## IME composition gating

The dialog's input handler ran on every keystroke with no composition gate, so typing pinyin like `ni hao` fired a search for the raw Latin letters before the user selected any characters — burning the rate budget and producing nonsense results. The chat input already solves this at `client/src/lib/chat-input-keyboard.ts`; the search dialog now mirrors it.

The dialog tracks a `compositionActiveRef`, set on `compositionStart` and cleared on `compositionEnd`. While it is true, the debounced auto-search is suppressed — but `setDraft` and `validateSearchQuery` keep running, so the input reflects what the user typed and invalid drafts (empty / short / too-long) still update the placeholder phase. When composition ends and the resulting draft is valid, the existing 300 ms debounce fires — rapid double-selects coalesce instead of triggering one search per character.

The `Enter` handler is gated with the full chat-input pattern: skip submission when `compositionActiveRef.current`, `event.nativeEvent.isComposing`, or `keyCode === 229` (the Safari fallback, since Safari sometimes reports `isComposing === false` mid-IME).

## Why not block all input handling while composing

Rejected — the draft and its validation should keep updating so placeholders and the short / too-long states still render. Swallowing `onValueChange` until composition end would leave the input showing stale text and prevent the validation-driven phase transitions from running.

## Backward compatibility

Old deployed clients continue to work after the server reorder: they still send `status` before `search`, and the reorder only changes which call (if any) consumes the budget — old clients were already prepared to handle a `rateLimited` response on either call. `server/test/search.integration.ts:466-482` continues to pass because the rate-limit test runs its five searches while `readiness === "ready"`, so each call still consumes the budget.
