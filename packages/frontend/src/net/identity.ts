/**
 * Persistent, login-free identity. A UUID is generated once per device and
 * stored in localStorage; it's what lets a refresh or a shared-URL open
 * reconnect to the exact same seat. The nickname is stored too so returning
 * players don't have to retype it.
 */
const PLAYER_ID_KEY = "party-hub:playerId";
const NICKNAME_KEY = "party-hub:nickname";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for older browsers.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getPlayerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = uuid();
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

export function getNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? "";
}

export function setNickname(name: string): void {
  localStorage.setItem(NICKNAME_KEY, name.trim());
}
