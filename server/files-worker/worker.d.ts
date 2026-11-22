export function handle(request: Request, env: { KEY: string; BUCKET: unknown }): Promise<Response>
declare const worker: { fetch: typeof handle }
export default worker
