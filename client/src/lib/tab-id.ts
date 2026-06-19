// Per-tab identifier used to tie a reconnecting WebSocket back to the same
// Call Participant on the server. Persists across in-tab reloads but not
// across tab close — closing the tab is taken to mean "I'm leaving the call",
// reopening it is a fresh join. See docs/adr/0001-call-disconnect-grace.md.

const STORAGE_KEY = "web-chat-tab-id";

let cached: string | null = null;

export function getTabId(): string {
  if (cached) return cached;
  let id = sessionStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(STORAGE_KEY, id);
  }
  cached = id;
  return id;
}
