export type Endpoints = Readonly<Bun.Serve.Routes<undefined, string>>

export const DEFAULT_HEADERS: HeadersInit = {
	'Cache-Control': 'no-cache, no-store, must-revalidate',
	Pragma: 'no-cache',
	Expires: '0',
}

export const NO_RESPONSE = new Response(undefined, { headers: DEFAULT_HEADERS })
export const INTERNAL_SERVER_ERROR_RESPONSE = new Response('Internal Server Error', { status: 500 })

export function query(req: Bun.BunRequest<string>) {
	return new URL(req.url).searchParams
}

export function response<T>(data?: T extends Promise<unknown> ? never : T, headers?: HeadersInit) {
	return data !== null && data !== undefined ? Response.json(data, { headers: headers ?? DEFAULT_HEADERS }) : NO_RESPONSE
}
