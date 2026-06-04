export function normalizePort(port: unknown) {
	if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) return undefined
	return port
}

export function normalizeTimeout(timeout: unknown, fallback: number = 30000) {
	if (typeof timeout !== 'number' || !Number.isFinite(timeout)) return fallback
	return Math.max(0, Math.trunc(timeout))
}
