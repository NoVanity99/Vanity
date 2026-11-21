// The starting list of official badges, by username. Each name is turned into a badge on the
// account that holds it, once (see people.ts); from then on the badge belongs to that account,
// whatever it is renamed to, and removing a name here does not take the badge away again.
// Admins give and take badges in Settings → Admin. Names are matched without regard to capitals.
//
// To add someone, put their Vanity username in the list and deploy the server (pushing this
// file runs the "Deploy backend" workflow by itself). Their badge shows within a minute.

/** The blue check: this account is officially who it says it is. */
export const VERIFIED_USERNAMES = ['SBCVanity', 'Max', 'chefdal', 'deggy', 'soupystew']

/** The gold crown: this account runs Vanity. */
export const ADMIN_USERNAMES = ['SBCVanity', 'chefdal', 'soupystew']

export interface Roles {
  verified: boolean
  admin: boolean
}
