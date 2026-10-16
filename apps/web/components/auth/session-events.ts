export const SESSION_CHANGE_EVENT = "lampstage:session-change";
export const SESSION_LOGOUT_STORAGE_KEY = "lampstage:session-logout";

export function notifySessionChanged() {
  window.dispatchEvent(new window.CustomEvent(SESSION_CHANGE_EVENT, { detail: "changed" }));
}

export function notifySessionExpired() {
  window.dispatchEvent(new window.CustomEvent(SESSION_CHANGE_EVENT, { detail: "expired" }));
  try {
    // A non-sensitive nonce lets other tabs clear their local account data.
    window.localStorage.setItem(SESSION_LOGOUT_STORAGE_KEY, `${Date.now()}:${Math.random()}`);
  } catch { /* Private browsing may disable storage; this tab is already cleared. */ }
}
