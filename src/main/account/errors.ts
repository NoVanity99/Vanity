/**
 * A failure with a message that can be shown to the user.
 * `signedOut`: the session is no longer valid. `offline`: the network or the service is down, so trying again later may work.
 */
export class AccountError extends Error {
  constructor(
    message: string,
    readonly signedOut = false,
    readonly offline = false
  ) {
    super(message)
  }
}
