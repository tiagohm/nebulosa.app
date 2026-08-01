export type Endpoints = Readonly<Bun.Serve.Routes<undefined, string>>

export const DEFAULT_HEADERS = {
	'Cache-Control': 'no-cache, no-store, must-revalidate',
	Pragma: 'no-cache',
	Expires: '0',
} as const

export const JSON_DEFAULT_HEADERS = {
	...DEFAULT_HEADERS,
	'Content-Type': 'application/json',
} as const

export const NO_RESPONSE = new Response(undefined, { headers: DEFAULT_HEADERS })
export const INTERNAL_SERVER_ERROR_RESPONSE = new Response('Internal Server Error', { status: 500 })
export const NOT_FOUND_RESPONSE = new Response('Not Found', { status: 404 })

export function query(req: Bun.BunRequest) {
	for (const [key, value] of new URL(req.url).searchParams) req.params[key] = value
	return req.params
}

export function response<T>(data?: T extends Promise<unknown> ? never : T, headers?: HeadersInit) {
	return data !== null && data !== undefined ? Response.json(data, { headers: headers ?? DEFAULT_HEADERS }) : NO_RESPONSE
}
