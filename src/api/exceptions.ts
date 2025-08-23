export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number = 500,
	) {
		super(message)
		this.name = 'ApiError'
	}
}

export function badRequest(message: string) {
	return new ApiError(message, 400)
}

export function notFound(message: string) {
	return new ApiError(message, 404)
}

export function deviceNotFound(type: string) {
	return notFound(`${type} not found`)
}

export function internalServerError(message: string) {
	return new ApiError(message, 500)
}

export function noActiveConnection() {
	return internalServerError('No active connection')
}
