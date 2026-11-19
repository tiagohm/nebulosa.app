import { expect, test } from 'bun:test'
import { Timescale } from 'nebulosa/src/astronomy/time/time'
import { downloadElementList, elementsOrbit, MPC_ELEMENT_LISTS, parseMpcElements } from './spicekernels.elements'

// MPCORB lines as the MPC publishes them in Soft00Bright.txt and NEA.txt.
const CERES = '00001    3.35  0.15 K25BL 231.53975   73.29974   80.24963   10.58789  0.0795763  0.21429712   2.7656157  0 MPO950947  7369 126 1801-2025 0.69 M-v 30k MPC        0000              (1) Ceres'
const EROS = '00433   10.39  0.15 K2669  62.51145  178.91814  304.26797   10.82855  0.2228780  0.55970463   1.4582437  0 E2026-TG8 18065  59 1893-2026 0.61 M-v 3Ek MPCORBFIT  1804    (433) Eros               20260919'
const NUMBERED_EXTENDED = `A1234${EROS.slice(5)}`
const PROVISIONAL = `K24A00A${EROS.slice(7)}`
const MALFORMED = `${EROS.slice(0, 92)}  xxxxxxx${EROS.slice(101)}`
const HEADER = "Des'n     H     G   Epoch     M        Peri.      Node       Incl.       e            n           a        Reference #Obs #Opp    Arc    rms  Perts   Computer"
const SEPARATOR = '-'.repeat(160)

test('the numbered asteroids of MPC 1-line elements are read, the others counted', () => {
	const preview = parseMpcElements([HEADER, SEPARATOR, CERES, '', EROS, PROVISIONAL, MALFORMED, EROS, NUMBERED_EXTENDED].join('\r\n'))

	expect(preview.skipped).toEqual({ unnumbered: 1, malformed: 1 })
	expect(preview.objects.map((e) => e.number)).toEqual([1, 433, 101234])

	const [ceres, eros] = preview.objects
	expect(ceres).toMatchObject({ name: '(1) Ceres', h: 3.35, g: 0.15, a: 2.7656157, e: 0.0795763 })
	expect(ceres.i).toBeCloseTo(10.58789, 9)
	expect(ceres.node).toBeCloseTo(80.24963, 9)
	expect(ceres.peri).toBeCloseTo(73.29974, 9)
	expect(ceres.meanAnomaly).toBeCloseTo(231.53975, 9)
	// K25BL is 2025-11-21 0h TT; K2669 is 2026-06-09.
	expect(ceres.epoch).toBe(2461000.5)
	expect(eros.epoch).toBe(2461200.5)
	expect(eros.name).toBe('(433) Eros')
})

test('the orbit of elements starts at their epoch in TT, on the equator', () => {
	const [eros] = parseMpcElements(EROS).objects
	const { kepler, epoch } = elementsOrbit(eros)
	expect(epoch.day + epoch.fraction).toBe(2461200.5)
	expect(epoch.scale).toBe(Timescale.TT)
	expect(kepler.semiMajorAxis).toBeCloseTo(1.4582437, 9)
	expect(kepler.eccentricity).toBeCloseTo(0.222878, 9)
})

test('a list is downloaded from its exact URL without following redirects', async () => {
	const list = MPC_ELEMENT_LISTS.find((e) => e.id === 'bright-2026')!
	const asked: { url: string; redirect?: RequestRedirect }[] = []
	const download = await downloadElementList(list, (url, init) => {
		asked.push({ url, redirect: init.redirect })
		return Promise.resolve(new Response(`${CERES}\n${EROS}\n`))
	})

	expect(asked).toEqual([{ url: 'https://www.minorplanetcenter.net/iau/Ephemerides/Bright/2026/Soft00Bright.txt', redirect: 'error' }])
	expect(download.ok && parseMpcElements(download.text).objects).toHaveLength(2)
	expect(MPC_ELEMENT_LISTS.every((e) => e.url.startsWith('https://www.minorplanetcenter.net/iau/'))).toBeTrue()
})

test('a list that fails, redirects, or is too large is reported, never thrown', async () => {
	const list = MPC_ELEMENT_LISTS[0]
	expect(await downloadElementList(list, () => Promise.resolve(new Response('gone', { status: 404 })))).toEqual({ ok: false, message: 'www.minorplanetcenter.net answered 404.' })
	expect(await downloadElementList(list, () => Promise.reject(new TypeError('unexpected redirect')))).toEqual({ ok: false, message: 'www.minorplanetcenter.net could not be reached: unexpected redirect' })

	const chunk = new Uint8Array(1024 * 1024)
	let sent = 0
	const huge = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent++ < 20) controller.enqueue(chunk)
			else controller.close()
		},
	})
	const download = await downloadElementList(list, () => Promise.resolve(new Response(huge)))
	expect(download.ok).toBeFalse()
	expect(sent).toBeLessThan(20)
})
