/** A voice problem, with words for the screen. `code` lets the UI pick an icon or a button. */
export class VoiceError extends Error {
  constructor(
    readonly code: 'not-configured' | 'unreachable' | 'signed-out' | 'mic-denied' | 'no-mic' | 'mic-busy' | 'not-found' | 'full' | 'version' | 'replaced' | 'server' | 'unsupported',
    message: string
  ) {
    super(message)
  }
}

const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

/** Turns what the browser says when a microphone can't be opened into plain words. */
export function micError(err: unknown): VoiceError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new VoiceError(
      'mic-denied',
      isWindows
        ? "Vanity isn't allowed to use your microphone. In Windows, open Settings → Privacy & security → Microphone and turn on \"Microphone access\" and \"Let desktop apps access your microphone\"."
        : "Vanity isn't allowed to use your microphone. Allow microphone access for Vanity in your device's settings."
    )
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return new VoiceError('no-mic', 'No microphone was found. Plug one in (or pick another in Settings → Voice). You can still listen.')
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return new VoiceError('mic-busy', "Your microphone couldn't be started. Another app may be using it, or Windows may need a moment. Try again, or pick another microphone.")
  }
  return new VoiceError('mic-busy', `Your microphone couldn't be started${err instanceof Error && err.message ? ` (${err.message})` : ''}.`)
}
