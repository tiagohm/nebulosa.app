import { routes } from 'api'
import index from 'web/index.html'

const development = process.env.NODE_ENV !== 'production'

const server = Bun.serve({
	hostname: process.env.APP_HOST || 'localhost',
	port: Number(process.env.APP_PORT) || 7000,
	development: development && { hmr: true, console: true },
	routes: {
		...routes,
		'/*': index,
	},
})

console.info(`Nebulosa is running at ${server.url}`)
