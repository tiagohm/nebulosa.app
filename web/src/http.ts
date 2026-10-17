// Helpers shared by the stores that call the API over HTTP.

// Reads the error message of a failed API response, which the API sends as { error: string }, falling
// back to the response's status line.
export async function responseError(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { error?: unknown }
		if (typeof body.error === 'string') return body.error
	} catch {
		// Not a JSON error body.
	}

	return `${response.status} ${response.statusText}`.trim()
}
