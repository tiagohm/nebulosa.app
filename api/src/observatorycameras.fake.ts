// Stand-in for MediaMTX, used only by the tests of Observatory Cameras, which run it as
// `bun observatorycameras.fake.ts <mode> [--version]`: it prints a version, or serves the parts of the control API and of
// WHEP the server uses, on the addresses of its MTX_* variables, and prints log lines as MediaMTX does. A path whose
// source contains "badauth" fails as a camera refusing its credentials. Modes: ok; exit, which ends the process 300 ms
// after it is ready; old, which reports version 1.20.0; and silent, which never listens.

// Behavior asked by the command line.
const mode = process.argv[2] ?? 'ok'

if (process.argv.includes('--version')) {
	console.info(mode === 'old' ? 'v1.20.0' : 'v1.21.3')
	process.exit(0)
}

if (mode === 'silent') await Bun.sleep(60000)

// Configured paths by name, with the configuration the control API received.
const paths = new Map<string, Record<string, unknown>>()

// Path read by each WebRTC session, by session id and by session resource.
const sessions = new Map<string, string>()

// Host and port of a listener from an MTX_* variable such as 127.0.0.1:9997.
function address(variable: string) {
	const [hostname, port] = process.env[variable]!.split(':')
	return { hostname, port: +port }
}

// Responds with one page holding every item, as the list endpoints of the control API do.
function list(items: readonly object[]) {
	return Response.json({ itemCount: items.length, pageCount: items.length > 0 ? 1 : 0, items })
}

Bun.serve({
	...address('MTX_APIADDRESS'),
	fetch: async (req) => {
		const { pathname } = new URL(req.url)
		const [, , group, action, kind, name] = pathname.split('/')

		if (pathname === '/v3/paths/list') return list([...paths.keys()].map((name) => ({ name })))
		if (pathname === '/v3/config/paths/list') return list([...paths.keys()].map((name) => ({ name })))
		if (pathname === '/v3/webrtc/sessions/list') return list([...sessions.keys()].map((id) => ({ id })))
		if (group === 'paths' && action === 'get') return paths.has(kind) ? Response.json({ name: kind, available: [...sessions.values()].includes(kind), readers: [...sessions.values()].filter((path) => path === kind).map((id) => ({ id })) }) : Response.json({ error: 'not found' }, { status: 404 })
		if (group === 'webrtc' && kind === 'kick') {
			sessions.delete(name)
			return Response.json({})
		}

		if (group === 'config' && action === 'paths') {
			const pathName = decodeURIComponent(name)
			if (kind === 'add' && paths.has(pathName)) return Response.json({ error: 'exists' }, { status: 400 })
			if ((kind === 'replace' || kind === 'delete') && !paths.has(pathName)) return Response.json({ error: 'not found' }, { status: 404 })
			if (kind === 'delete') paths.delete(pathName)
			else paths.set(pathName, (await req.json()) as Record<string, unknown>)
			console.info(`INF [path ${pathName}] configured`)
			return Response.json({ status: 'ok' })
		}

		return new Response(null, { status: 404 })
	},
})

Bun.serve({
	...address('MTX_WEBRTCADDRESS'),
	fetch: async (req) => {
		const [, pathName, whep, resource] = new URL(req.url).pathname.split('/')
		if (whep !== 'whep') return new Response(null, { status: 404 })

		if (req.method === 'POST') {
			const config = paths.get(pathName)
			if (!config) return Response.json({ status: 'error', error: `no stream is available on path '${pathName}'` }, { status: 404 })

			if (String(config.source).includes('badauth')) {
				console.info(`2026/11/06 10:58:59 ERR [path ${pathName}] [RTSP source] bad status code: 401 (Unauthorized)`)
				return Response.json({ status: 'error', error: `source of path '${pathName}' has timed out` }, { status: 400 })
			}

			const id = Bun.randomUUIDv7()
			const secret = Bun.randomUUIDv7()
			sessions.set(id, pathName)
			sessions.set(`${id}:${secret}`, pathName)
			console.info(`2026/11/06 10:58:06 INF [path ${pathName}] stream is available and online, 1 track (H264)`)
			return new Response(`answer to ${await req.text()}`, { status: 201, headers: { 'content-type': 'application/sdp', location: `/${pathName}/whep/${id}:${secret}`, id, etag: '*', 'accept-patch': 'application/trickle-ice-sdpfrag' } })
		}

		if (!sessions.has(resource)) return new Response(null, { status: 404 })
		if (req.method === 'PATCH') return new Response(null, { status: 204 })

		sessions.delete(resource)
		sessions.delete(resource.split(':')[0])
		return new Response(null, { status: 200 })
	},
})

if (mode === 'exit') {
	await Bun.sleep(300)
	process.exit(3)
}
