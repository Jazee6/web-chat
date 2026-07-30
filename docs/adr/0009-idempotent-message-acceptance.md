# User messages use idempotent server acceptance

Every user Message Submission carries a stable client-generated submission id, scoped to the user and room. The server persists a submission at most once, assigns the Chat Message's canonical server id, and returns a Message Acceptance containing the submission id and complete Chat Message; retrying the same submission returns that same message. This preserves server ownership of message identity while making retries safe and allowing the sender to replace its optimistic id before the message can become a Reply antecedent.

## Why

Writing to a WebSocket does not prove that a message reached room history. Without an acceptance response, the client can neither distinguish a persisted message from a failed send nor reconcile its optimistic id with the server id used by other clients and persisted Reply snapshots. Making the client id canonical would remove the reconciliation step, but would also move ownership of persistent message identity to untrusted clients.

## Consequences

- Every user-authored message type remains Sending until Message Acceptance. A disconnect or ten seconds without acceptance marks it Send Failed; a late acceptance still reconciles it.
- Retrying reuses the submission id. Image retries also reuse uploaded storage keys rather than uploading the bytes again.
- Sending and Send Failed messages cannot be Reply antecedents. Once accepted, the complete server message replaces the optimistic message and Reply references its canonical id.
- Pending and failed submissions exist only in the current page session.
- Quote navigation remains best-effort for antecedents outside loaded history, as decided in ADR 0003.
