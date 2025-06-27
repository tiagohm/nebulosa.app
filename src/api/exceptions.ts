// API error
export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number = 500,
	) {
		super(message)
		this.name = 'ApiError'
	}
}

// Creates an instance of ApiError for a bad request error
export function badRequest(message: string) {
	return new ApiError(message, 400)
}

// Creates an instance of ApiError for a not found error
export function notFound(message: string) {
	return new ApiError(message, 404)
}

// Creates an instance of ApiError for a device not found error
export function deviceNotFound(type: string) {
	return notFound(`${type} not found`)
}

// Creates an instance of ApiError for internal server errors
export function internalServerError(message: string) {
	return new ApiError(message, 500)
}

// Creates an instance of ApiError for no active connection error
export function noActiveConnection() {
	return internalServerError('No active connection')
}
