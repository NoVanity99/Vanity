import type { VanityApi } from '../shared/ipc'

declare global {
  interface Window {
    vanity: VanityApi
  }
}
