# User messages use idempotent server acceptance

Every user Message Submission carries a stable client-generated submission id, scoped to the user and room. The server persists a submission at most once, assigns the Chat Message's canonical server id, and returns a Message Acceptance containing the submission id and complete Chat Message; retrying the same payload returns that same message, while reusing the id for a different payload produces Message Rejection. This preserves server ownership of message identity while making retries safe and allowing the sender to replace its optimistic id before the message can become a Reply antecedent.

## Why

Writing to a WebSocket does not prove that a message reached room history. Without an acceptance response, the client can neither distinguish a persisted message from a failed send nor reconcile its optimistic id with the server id used by other clients and persisted Reply snapshots. Making the client id canonical would remove the reconciliation step, but would also move ownership of persistent message identity to untrusted clients. Persisting a browser Outbox would survive refreshes, but would also retain unsent conversation content beyond the current room view, so submissions remain page-local.

## Consequences

- A submission created or interrupted without a room connection becomes Waiting for Connection. After join completes, the client reconciles history and resends each waiting submission once, in insertion order, with the same id. Ten seconds without acceptance while connected marks it Send Failed; a late acceptance still reconciles it.
- Room history includes a message's submission id only for its submitting user. This removes an optimistic duplicate when persistence succeeded but the original Acceptance was lost without exposing idempotency keys to other room users.
- Message Rejection is terminal for the unchanged submission. Invalid content and reuse of an id for a different payload are rejected rather than left to time out as Send Failed.
- Retrying a Message Submission reuses its id. Retrying an Upload Failed file reuses successful files in that image batch; after recovery, the user confirms the image submission.
- Waiting, Sending, Send Failed, and Rejected messages cannot be Reply antecedents. Once accepted, the complete server message replaces the optimistic message and Reply references its canonical id.
- Pending and failed submissions exist only in the current page session.
- Quote navigation remains best-effort for antecedents outside loaded history, as decided in ADR 0003.
