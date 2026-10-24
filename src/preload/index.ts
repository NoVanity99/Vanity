import { contextBridge } from 'electron'

// The typed `window.vanity` API (see src/shared/ipc.ts) is wired up in stage 2.
contextBridge.exposeInMainWorld('vanity', {})
