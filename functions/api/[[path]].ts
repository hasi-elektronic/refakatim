// Same-origin proxy: /api/* on the site → refakatim-api Worker via service binding.
// Keeps the form API reachable where *.workers.dev is blocked.
interface Env { API: { fetch: (r: Request) => Promise<Response> } }

export const onRequest = async ({ request, env }: { request: Request; env: Env }) => env.API.fetch(request);
