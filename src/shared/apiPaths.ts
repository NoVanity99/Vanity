// The parts of the Vanity server the app's screens may ask for directly (through
// window.vanity.account.request), besides the calls that have their own named function.
// Anything else is refused before it leaves the app.

const ALLOWED = [
  /^\/pulse$/,
  /^\/coins(\/(checkout|buy|history|plus\/checkout|plus\/portal))?$/,
  /^\/games\/[^/?#\s]{1,200}\/comments$/,
  /^\/comments\/\d{1,15}(\/report)?$/,
  /^\/voice\/call$/,
  /^\/voice\/rings\/[\w-]{1,64}\/decline$/,
  // Channels (communities with rooms): see server/src/communities.ts.
  /^\/communities(\/(discover|last-place))?$/,
  /^\/communities\/[\w-]{1,40}(\/(join|request|leave|transfer|members|bans|requests|invites|categories|channels|layout))?$/,
  /^\/communities\/[\w-]{1,40}\/(members|bans|requests|invites)\/[\w-]{1,80}$/,
  /^\/communities\/invites\/[A-Za-z0-9]{4,20}(\/join)?$/,
  /^\/communities\/(categories|channels)\/[\w-]{1,40}$/,
  /^\/communities\/channels\/[\w-]{1,40}\/messages$/,
  /^\/communities\/messages\/\d{1,15}$/,
  /^\/communities\/messages\/\d{1,15}\/reactions\/[^/?#\s]{1,80}$/,
  /^\/admin\/(overview|users|reports|log|test-users|test-users\/clear)$/,
  /^\/admin\/users\/[\w-]{1,80}(\/(ban|unban|timeout|roles|coins|reset-profile|username|clear-cooldown|delete-comments|kick-voice|view|plus))?$/,
  /^\/admin\/reports\/\d{1,15}$/
]
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']

/** Whether a request to this path (which may carry a ?query) is one the screens may make. */
export function allowedApiRequest(method: string, path: string): boolean {
  if (!METHODS.includes(method) || typeof path !== 'string' || path.length > 600) return false
  const [plain, query = ''] = path.split('?')
  if (!/^[\w=&%.\-:+@~]*$/.test(query)) return false
  // PUT is only used by Channels (a layout, your last place).
  if (method === 'PUT' && !plain.startsWith('/communities/')) return false
  return ALLOWED.some((p) => p.test(plain))
}
