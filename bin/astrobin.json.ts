import * as astrobin from 'nebulosa/src/astrobin'

async function fetchAndRetryOnError<T>(action: () => Promise<T | undefined>) {
	let attempt = 0

	while (attempt++ < 10) {
		const res = await action()

		if (res === undefined) {
			console.info('retrying...')
			Bun.sleepSync(attempt * 100)
		} else {
			return res
		}
	}

	console.info('no more retries!')

	return undefined
}

const sensors = new Map<number, astrobin.AstrobinSensor>()
let page = 1

while (true) {
	const res = await fetchAndRetryOnError(() => astrobin.sensors(page))

	if (!res || res.results.length === 0) break

	console.info('sensor:', res.results.length, page++)

	for (const result of res.results) {
		sensors.set(result.id, result)
	}

	Bun.sleepSync(100)
}

console.info(`found ${sensors.size} sensors`)

page = 1

const cameras = []
const duplicates = new Set<string>()

while (true) {
	const res = await fetchAndRetryOnError(() => astrobin.cameras(page))

	if (!res || res.results.length === 0) break

	console.info('camera:', res.results.length, page++)

	for (const result of res.results) {
		if (!result.sensor) continue
		const sensor = sensors.get(result.sensor)
		if (!sensor) continue
		if (!sensor.pixelSize || !sensor.pixelWidth || !sensor.pixelHeight) continue
		const name = `${result.brandName} ${result.name}`
		if (duplicates.has(name)) continue
		cameras.push({ id: result.id, name, sensor: `${sensor.brandName} ${sensor.name}`, w: sensor.pixelWidth, h: sensor.pixelHeight, ps: +sensor.pixelSize })
		duplicates.add(name)
	}

	Bun.sleepSync(100)
}

await Bun.write('data/cameras.json', JSON.stringify(cameras))

console.info(`found ${cameras.length} cameras`)

page = 1
duplicates.clear()

const telescopes = []

while (true) {
	const res = await fetchAndRetryOnError(() => astrobin.telescopes(page))

	if (!res || res.results.length === 0) break

	console.info('telescope:', res.results.length, page++)

	for (const result of res.results) {
		if (!result.aperture || !result.maxFocalLength) continue
		const name = `${result.brandName} ${result.name}`
		if (duplicates.has(name)) continue
		telescopes.push({ id: result.id, name, ap: +result.aperture, fl: +result.maxFocalLength })
		duplicates.add(name)
	}

	Bun.sleepSync(100)
}

await Bun.write('data/telescopes.json', JSON.stringify(telescopes))

console.info(`found ${telescopes.length} telescopes`)
