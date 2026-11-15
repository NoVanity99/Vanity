// Android has no Node file system. Shared code that imports node:fs gets this instead:
// every call fails, which that code already treats as "file not found".
const unavailable = async (): Promise<never> => {
  throw new Error('The file system is not available on Android.')
}

export const promises = new Proxy({} as Record<string, () => Promise<never>>, { get: () => unavailable })
export type Dirent = never
export const existsSync = (): boolean => false
export const readFileSync = (): never => {
  throw new Error('The file system is not available on Android.')
}
export const createReadStream = readFileSync
export default { promises, existsSync, readFileSync }
