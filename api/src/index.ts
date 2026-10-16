export const routes = {
	'/api/health': {
		GET: () => Response.json({ status: 'ok' }),
	},
}
