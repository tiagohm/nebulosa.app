import type { ManagedDeviceType } from 'api'

// Helpers shared by the stores that call the API over HTTP: the routes of the devices, JSON request bodies, JSON
// responses, and the error messages of failed responses.

// URL segment of the routes of each device type.
export const DEVICE_PATHS: Readonly<Record<ManagedDeviceType, string>> = {
	camera: 'cameras',
	mount: 'mounts',
	focuser: 'focusers',
	wheel: 'wheels',
	rotator: 'rotators',
	guideOutput: 'guide-outputs',
	dome: 'domes',
	cover: 'covers',
	flatPanel: 'flat-panels',
	dewHeater: 'dew-heaters',
}

// Returns the URL of a device of an open connection, or of one of its routes when action names it, such as "move"
// or "capture/stop".
export function deviceUrl(connectionId: string, type: ManagedDeviceType, deviceId: string, action?: string) {
	const url = `/api/connections/${encodeURIComponent(connectionId)}/${DEVICE_PATHS[type]}/${encodeURIComponent(deviceId)}`
	return action ? `${url}/${action}` : url
}

// Returns the init of a request sending body as JSON with a method; an undefined body sends none. signal aborts it.
export function jsonInit(method: 'POST' | 'PUT' | 'PATCH', body?: unknown, signal?: AbortSignal): RequestInit {
	return { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal }
}

// Reads the error message of a failed API response, which the API sends as { error, code } (ApiError), falling
// back to fallback when given, or to the response's status line.
export async function responseError(response: Response, fallback?: string): Promise<string> {
	try {
		const body = (await response.json()) as { error?: unknown }
		if (typeof body.error === 'string') return body.error
	} catch {
		// Not a JSON error body.
	}

	return fallback ?? `${response.status} ${response.statusText}`.trim()
}

// Failed API response: the API's error message, with the response's status.
export class ApiResponseError extends Error {
	// Creates the error of a response answered with a status (such as 404).
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message)
	}
}

// Fetches JSON from the API through io's fetch, rejecting with an ApiResponseError carrying the API's error message
// and the status on failure.
export async function fetchJson<T>(io: { readonly fetch: (input: string, init?: RequestInit) => Promise<Response> }, input: string, init?: RequestInit): Promise<T> {
	const response = await io.fetch(input, init)
	if (!response.ok) throw new ApiResponseError(await responseError(response), response.status)
	return (await response.json()) as T
}
