import type { ArtworkKind } from '@shared/types'

/**
 * Artwork on Android: images aren't copied into a folder like on desktop. The database keeps
 * each image's web address and the web view's own cache stores the file.
 * (Same methods as the desktop MediaCache, so the shared metadata code can use either.)
 */
export class MobileMedia {
  readonly root = ''

  /** Web addresses are used as they are. */
  resolve(path: string): string | null {
    return /^https:\/\//i.test(path) ? path : null
  }

  async download(_gameId: number, _kind: ArtworkKind, url: string): Promise<string | null> {
    return /^https:\/\//i.test(url) ? url : null
  }

  async importFile(): Promise<string> {
    throw new Error('Choosing your own image file is not available on Android yet. Pick one of the suggested images instead.')
  }

  async prune(): Promise<void> {}
  async removeGame(): Promise<void> {}
  async size(): Promise<number> {
    return 0
  }
}
