// Who gets the official badges. This list is the only place they are granted: nobody can
// give themselves one from the app. Names are matched without regard to capitals.
//
// To add someone, put their Vanity username in the list and deploy the server
// (pushing this file runs the "Deploy backend" workflow by itself).

/** The blue check: this account is officially who it says it is. */
export const VERIFIED_USERNAMES = ['SBCVanity']

/** The gold crown: this account runs Vanity. */
export const ADMIN_USERNAMES = ['SBCVanity']

export interface Roles {
  verified: boolean
  admin: boolean
}

const has = (list: string[], username: string): boolean => list.some((n) => n.toLowerCase() === username.toLowerCase())

export function rolesFor(username: string | null | undefined): Roles {
  if (!username) return { verified: false, admin: false }
  return { verified: has(VERIFIED_USERNAMES, username), admin: has(ADMIN_USERNAMES, username) }
}
