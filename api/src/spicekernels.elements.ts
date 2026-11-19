import { unpackMPCDesignation } from 'nebulosa/src/adapters/orbits/mpc'
import type { SpkType9Segment } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.write'
import { asteroid } from 'nebulosa/src/astronomy/orbits/asteroid'
import { mpcorb, unpackDate } from 'nebulosa/src/astronomy/orbits/mpcorb'
import { Timescale, time, timeYMD } from 'nebulosa/src/astronomy/time/time'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'
import { MpcKernelError, type SmallBodyOrbit } from './spicekernels.mpc'

// Element sets of the SPICE Kernel Library: the MPC 1-line (MPCORB) asteroid elements of an uploaded file or of one of the
// lists the Minor Planet Center publishes, read into the numbered asteroids they hold (the only ones whose SBDB SPK-ID,
// 20000000 + number, is known without asking SBDB), and their integration into the segments of one kernel by worker
// threads, each over its own read-only copy of the enabled kernels, so a batch of thousands of bodies neither blocks the
// event loop nor waits on one core. A list is downloaded only from the exact URLs of MPC_ELEMENT_LISTS, never from a URL a
// request names.

// Origin of the MPC files the lists come from.
const MPC_FILES = 'https://www.minorplanetcenter.net/iau'

// Longest wait for a list, in milliseconds: the largest lists (about 9 MB) took 40 s from minorplanetcenter.net, so the
// budget leaves room for a slower link.
export const LIST_TIMEOUT_MS = 180_000

// Largest list read, in bytes; the largest published list is under 10 MB.
const LIST_MAX_BYTES = 16 * 1024 * 1024

// User-Agent of the downloads of the lists.
const USER_AGENT = 'Nebulosa (+https://github.com/tiagohm/nebulosa.app)'

// Packed epoch of an MPCORB line (columns 21-25): the century letter, the year, the month, and the day. A line without
// one is a header, a separator, or text, and is ignored rather than counted as malformed.
const PACKED_EPOCH = /^[I-L]\d\d[1-9A-C][1-9A-V]$/

// Shortest MPCORB line holding every element (through the semi-major axis, column 103).
const MIN_LINE_LENGTH = 103

// Objects one worker integrates per request, so the batch is shared across the workers as they free up.
const CHUNK_OBJECTS = 16

// Longest wait, in milliseconds, for a worker to close its kernel files before it is terminated.
const CLOSE_TIMEOUT_MS = 5000

// An MPC list of 1-line asteroid elements the library may download.
export interface SpiceElementList {
	// Stable id, sent to download it.
	readonly id: string
	// Title shown to people.
	readonly title: string
	// Exact HTTPS URL of the file.
	readonly url: string
	// Size of the file when it was listed, bytes.
	readonly bytes: number
}

// Lists of 1-line asteroid elements the Minor Planet Center publishes, as Stellarium's Solar System Editor bookmarks them
// from minorplanetcenter.net; sizes as of 2026-11-19. The lists of comets are left out, since only numbered asteroids are
// imported, and so are Stellarium's own mirrors. The bright minor planets list is that of 2026, as the MPC names it.
export const MPC_ELEMENT_LISTS: readonly SpiceElementList[] = [
	{ id: 'observable-critical', title: 'Observable critical-list numbered minor planets', url: `${MPC_FILES}/Ephemerides/CritList/Soft00CritList.txt`, bytes: 519908 },
	{ id: 'observable-distant', title: 'Observable distant minor planets', url: `${MPC_FILES}/Ephemerides/Distant/Soft00Distant.txt`, bytes: 764144 },
	{ id: 'observable-unusual', title: 'Observable unusual minor planets', url: `${MPC_FILES}/Ephemerides/Unusual/Soft00Unusual.txt`, bytes: 9847636 },
	{ id: 'bright-2026', title: 'Bright minor planets at opposition in 2026', url: `${MPC_FILES}/Ephemerides/Bright/2026/Soft00Bright.txt`, bytes: 59808 },
	{ id: 'mpcorb-nea', title: 'MPCORB: near-Earth asteroids', url: `${MPC_FILES}/MPCORB/NEA.txt`, bytes: 8766352 },
	{ id: 'mpcorb-pha', title: 'MPCORB: potentially hazardous asteroids', url: `${MPC_FILES}/MPCORB/PHA.txt`, bytes: 515620 },
	{ id: 'mpcorb-distant', title: 'MPCORB: TNOs, Centaurs, and SDOs', url: `${MPC_FILES}/MPCORB/Distant.txt`, bytes: 1903937 },
	{ id: 'mpcorb-unusual', title: 'MPCORB: other unusual objects', url: `${MPC_FILES}/MPCORB/Unusual.txt`, bytes: 8766555 },
	{ id: 'mpcorb-nea-today', title: 'MPCORB: near-Earth asteroids at an epoch near today', url: `${MPC_FILES}/MPCORB/NEAm00.txt`, bytes: 8755999 },
	{ id: 'mpcorb-daily', title: 'MPCORB: orbits of the latest Daily Orbit Update', url: `${MPC_FILES}/MPCORB/DAILY.DAT`, bytes: 7391027 },
	{ id: 'mpcat-unusual', title: 'MPCAT: unusual minor planets, NEOs included', url: `${MPC_FILES}/ECS/MPCAT/unusual.txt`, bytes: 4153177 },
	{ id: 'mpcat-distant', title: 'MPCAT: distant minor planets', url: `${MPC_FILES}/ECS/MPCAT/distant.txt`, bytes: 883253 },
	{ id: 'mpcat-mpo', title: 'MPCAT: one-opposition objects, perturbed solutions', url: `${MPC_FILES}/ECS/MPCAT/mpo.txt`, bytes: 1668863 },
	{ id: 'mpcat-mp1', title: 'MPCAT: one-opposition objects, unperturbed solutions', url: `${MPC_FILES}/ECS/MPCAT/mp1.txt`, bytes: 538559 },
]

// Osculating heliocentric elements of a numbered asteroid, on the J2000 ecliptic, as an MPCORB line gives them.
export interface SpiceElementsObject {
	// Permanent number.
	readonly number: number
	// Name shown to people, such as "(433) Eros".
	readonly name: string
	// Absolute magnitude H and slope G, when the line has them.
	readonly h?: number
	readonly g?: number
	// Osculating epoch, Julian date (TT).
	readonly epoch: number
	// Semi-major axis, AU, and eccentricity, from 0 to below 1.
	readonly a: number
	readonly e: number
	// Inclination, longitude of the ascending node, argument of perihelion, and mean anomaly at the epoch, degrees.
	readonly i: number
	readonly node: number
	readonly peri: number
	readonly meanAnomaly: number
}

// What a file or a list holds: its numbered asteroids, in file order without repetition, and how many element lines were
// left out because they are not numbered or cannot be read.
export interface SpiceElementsPreview {
	readonly objects: readonly SpiceElementsObject[]
	readonly skipped: { readonly unnumbered: number; readonly malformed: number }
}

// Reads the numbered asteroids of MPC 1-line asteroid elements. Lines without a packed epoch (headers, separators, text)
// are ignored; an element line of a provisional designation counts as unnumbered, and one whose designation, epoch, or
// closed-orbit elements cannot be read as malformed. A number met again keeps its first line.
export function parseMpcElements(text: string): SpiceElementsPreview {
	const objects: SpiceElementsObject[] = []
	const seen = new Set<number>()
	let unnumbered = 0
	let malformed = 0

	for (const line of text.split(/\r?\n/)) {
		if (line.length < MIN_LINE_LENGTH || !PACKED_EPOCH.test(line.slice(20, 25))) continue

		const orbit = mpcorb(line)
		if (!orbit) continue

		let designation: string
		let epoch: number

		try {
			designation = unpackMPCDesignation(orbit.designationPacked.trim())
			const t = timeYMD(...unpackDate(orbit.epochPacked), 0, Timescale.TT)
			epoch = t.day + t.fraction
		} catch {
			malformed++
			continue
		}

		if (!/^\d+$/.test(designation)) {
			unnumbered++
			continue
		}

		const { semiMajorAxis: a, eccentricity: e, inclination, longitudeOfAscendingNode, argumentOfPerihelion, meanAnomaly } = orbit

		if (!(a > 0 && e >= 0 && e < 1) || ![inclination, longitudeOfAscendingNode, argumentOfPerihelion, meanAnomaly].every(Number.isFinite)) {
			malformed++
			continue
		}

		const number = Number(designation)
		if (seen.has(number)) continue
		seen.add(number)

		objects.push({
			number,
			name: orbit.designation || `(${number})`,
			h: Number.isFinite(orbit.magnitudeH) ? orbit.magnitudeH : undefined,
			g: Number.isFinite(orbit.magnitudeG) ? orbit.magnitudeG : undefined,
			epoch,
			a,
			e,
			i: toDeg(inclination),
			node: toDeg(longitudeOfAscendingNode),
			peri: toDeg(argumentOfPerihelion),
			meanAnomaly: toDeg(meanAnomaly),
		})
	}

	return { objects, skipped: { unnumbered, malformed } }
}

// The orbit an integration of an element set starts from: the heliocentric conic of its elements, rotated from the
// ecliptic to the equator, at its epoch (TT). MPC 1-line elements carry no non-gravitational acceleration.
export function elementsOrbit(object: SpiceElementsObject): SmallBodyOrbit {
	const day = Math.floor(object.epoch)
	const epoch = time(day, object.epoch - day, Timescale.TT)
	return { kepler: asteroid(object.a, object.e, deg(object.i), deg(object.node), deg(object.peri), deg(object.meanAnomaly), epoch), epoch }
}

// Outcome of a download of a list: its text, or why it could not be read.
export type SpiceElementListDownload = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly message: string }

// Downloads a list from its exact URL, following no redirect, within LIST_TIMEOUT_MS and LIST_MAX_BYTES. Never rejects but
// when `signal` aborts.
export async function downloadElementList(list: SpiceElementList, fetch: (url: string, init: RequestInit) => Promise<Response>, signal?: AbortSignal): Promise<SpiceElementListDownload> {
	const host = new URL(list.url).host
	const timeout = AbortSignal.timeout(LIST_TIMEOUT_MS)
	let response: Response

	try {
		response = await fetch(list.url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, redirect: 'error', headers: { 'User-Agent': USER_AGENT } })
	} catch (error) {
		signal?.throwIfAborted()
		return { ok: false, message: timeout.aborted ? `${host} did not answer in time.` : `${host} could not be reached: ${Error.isError(error) ? error.message : String(error)}` }
	}

	if (!response.ok || !response.body) {
		await response.body?.cancel()
		return { ok: false, message: `${host} answered ${response.status}.` }
	}

	const reader = response.body.getReader()
	const chunks: Uint8Array[] = []
	let length = 0

	try {
		for (let result = await reader.read(); !result.done; result = await reader.read()) {
			length += result.value.byteLength

			if (length > LIST_MAX_BYTES) {
				await reader.cancel()
				return { ok: false, message: `${list.url} is larger than ${LIST_MAX_BYTES} bytes.` }
			}

			chunks.push(result.value)
		}
	} catch (error) {
		signal?.throwIfAborted()
		return { ok: false, message: `${host} stopped sending: ${Error.isError(error) ? error.message : String(error)}` }
	}

	return { ok: true, text: new TextDecoder('latin1').decode(Buffer.concat(chunks)) }
}

// A kernel file a worker opens: its id in the library and its path.
export interface SpiceKernelFileRef {
	readonly id: string
	readonly path: string
}

// What the workers integrate: the objects, the enabled kernels and preferences they open, and the window, Unix
// milliseconds (UTC).
export interface ElementsBatch {
	readonly objects: readonly SpiceElementsObject[]
	readonly kernels: readonly SpiceKernelFileRef[]
	readonly preferences: readonly (readonly [number, string])[]
	readonly start: number
	readonly end: number
}

// An object whose integration failed, and why.
export interface ElementsBatchFailure {
	readonly number: number
	readonly name: string
	readonly message: string
}

// The segments of a batch, by increasing target, the objects that failed, and the kernels the integrations read.
export interface ElementsBatchResult {
	readonly segments: readonly SpkType9Segment[]
	readonly failed: readonly ElementsBatchFailure[]
	readonly kernelIds: readonly string[]
}

// Messages to a worker: open the kernels and the window, integrate chunks of objects, then stop and close the files.
export type ElementsWorkerRequest =
	| { readonly type: 'open'; readonly kernels: readonly SpiceKernelFileRef[]; readonly preferences: readonly (readonly [number, string])[]; readonly start: number; readonly end: number }
	| { readonly type: 'integrate'; readonly objects: readonly SpiceElementsObject[] }
	| { readonly type: 'close' }

// Messages of a worker: ready for a chunk, one integrated segment (its tables transferred), one failed object, a chunk
// done, an error that ends the batch (a missing planetary body, kernels that cannot be opened), or its files closed.
export type ElementsWorkerResponse =
	| { readonly type: 'ready' }
	| { readonly type: 'closed' }
	| { readonly type: 'segment'; readonly segment: SpkType9Segment; readonly kernelIds: readonly string[] }
	| { readonly type: 'failed'; readonly failure: ElementsBatchFailure }
	| { readonly type: 'chunkDone' }
	| { readonly type: 'error'; readonly missingDependency: boolean; readonly message: string; readonly bodies: readonly number[] }

// Worker thread of the integrations. `unref` is a Bun extension that the DOM Worker type lacks.
type ElementsWorker = Worker & Pick<Bun.Worker, 'unref'>

// Starts a worker of the integrations.
function startWorker(): ElementsWorker {
	const worker = new Worker(process.env.NEBULOSA_SPICEKERNELS_WORKER ?? new URL('./spicekernels.worker.ts', import.meta.url)) as ElementsWorker
	worker.unref()
	return worker
}

// Asks a worker to stop and close its kernel files, so none stays open (Windows would refuse to delete it), and terminates
// it once it has, or after CLOSE_TIMEOUT_MS.
function close(worker: ElementsWorker) {
	const timer = setTimeout(() => worker.terminate(), CLOSE_TIMEOUT_MS)

	worker.addEventListener('message', (event: MessageEvent<ElementsWorkerResponse>) => {
		if (event.data.type !== 'closed') return
		clearTimeout(timer)
		worker.terminate()
	})

	worker.postMessage({ type: 'close' } satisfies ElementsWorkerRequest, [])
}

// Number of workers of a batch: one per core but the one of the event loop, at least one, at most one per object.
function workerCount(objects: number) {
	return Math.max(1, Math.min(objects, (navigator.hardwareConcurrency || 2) - 1))
}

// Integrates the objects of a batch on worker threads, handing chunks of CHUNK_OBJECTS to each as it frees up, and reports
// the objects done after each one. Rejects with MpcKernelError (missingDependency) when the kernels miss a planetary body,
// with an Error when a worker fails, or with the reason of `signal` when it aborts; the workers are terminated in every case.
export function integrateElementsBatch(batch: ElementsBatch, signal: AbortSignal, progress: (done: number, total: number) => void): Promise<ElementsBatchResult> {
	return new Promise((resolve, reject) => {
		const total = batch.objects.length
		const segments: SpkType9Segment[] = []
		const failed: ElementsBatchFailure[] = []
		const kernelIds = new Set<string>()
		const workers: ElementsWorker[] = []
		let next = 0
		let busy = 0
		let done = 0
		let settled = false

		function finish(error?: unknown) {
			if (settled) return
			settled = true
			signal.removeEventListener('abort', onAbort)
			for (const worker of workers) close(worker)
			if (error !== undefined) reject(asError(error))
			else resolve({ segments: segments.sort((a, b) => a.target - b.target), failed, kernelIds: [...kernelIds] })
		}

		function dispatch(worker: ElementsWorker) {
			if (next >= total) {
				if (busy === 0) finish()
				return
			}

			const objects = batch.objects.slice(next, next + CHUNK_OBJECTS)
			next += objects.length
			busy++
			worker.postMessage({ type: 'integrate', objects } satisfies ElementsWorkerRequest, [])
		}

		function onAbort() {
			finish(signal.reason ?? new Error('Aborted'))
		}

		if (signal.aborted) {
			reject(asError(signal.reason))
			return
		}

		if (total === 0) {
			resolve({ segments, failed, kernelIds: [] })
			return
		}

		signal.addEventListener('abort', onAbort, { once: true })

		for (let i = workerCount(total); i > 0; i--) {
			const worker = startWorker()
			workers.push(worker)

			worker.addEventListener('message', (event: MessageEvent<ElementsWorkerResponse>) => {
				const message = event.data

				if (settled || message.type === 'closed') return
				if (message.type === 'ready') dispatch(worker)
				else if (message.type === 'segment') {
					segments.push(message.segment)
					for (const id of message.kernelIds) kernelIds.add(id)
					progress(++done, total)
				} else if (message.type === 'failed') {
					failed.push(message.failure)
					progress(++done, total)
				} else if (message.type === 'chunkDone') {
					busy--
					dispatch(worker)
				} else finish(message.missingDependency ? new MpcKernelError(message.message, 'missingDependency', message.bodies) : new Error(message.message))
			})

			worker.addEventListener('error', (event: ErrorEvent) => finish(new Error(event.message || 'A worker of the integration failed.')))
			worker.postMessage({ type: 'open', kernels: batch.kernels, preferences: batch.preferences, start: batch.start, end: batch.end } satisfies ElementsWorkerRequest, [])
		}
	})
}

// An abort reason or failure as an Error, as a rejection must be.
function asError(reason: unknown) {
	return Error.isError(reason) ? reason : new Error(String(reason))
}
