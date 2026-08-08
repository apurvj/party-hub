/**
 * Room code format shared by client (validation) and server (generation).
 * 6 chars, unambiguous alphabet (no O/0/I/1/L) so codes are easy to read aloud
 * and type from a shared link.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_RE.test(code);
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase();
}
