export interface User {
  id: string;
  username: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
  /** optimistic concurrency: profile writes must send the version they saw; stale -> 409 */
  version: number;
}

export const USERNAME_PATTERN = "^[a-z0-9_-]{3,20}$";
export const PASSWORD_MIN_LENGTH = 8;

const USERNAME_RE = new RegExp(USERNAME_PATTERN);

/** null when valid, otherwise a human-readable reason */
export function validateUsername(username: string): string | null {
  if (!USERNAME_RE.test(username)) return "3–20 characters: a-z, 0-9, - and _";
  return null;
}

/** null when valid, otherwise a human-readable reason */
export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  return null;
}
