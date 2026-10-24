// Error responses shared by every route: each error is answered as { error, code }, a message meant for people and a
// stable code a client can rely on. Each service names its own codes (CommandErrorCode, StarDetectionErrorCode, and so
// on); a route may add the fields it documents, such as the current state after a conflict.

// Body of an error response.
export interface ApiError<C extends string = string> {
	// Message meant for people.
	readonly error: string
	// Stable code of the error.
	readonly code: C
}

// Responds with an error message, a status, and a stable code; details are the extra fields of the body.
export function errorResponse(message: string, status: number, code: string, details?: object): Response {
	return Response.json({ ...details, error: message, code } satisfies ApiError, { status })
}
