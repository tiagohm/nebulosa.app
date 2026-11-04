import { type Constellation, CONSTELLATIONS } from 'nebulosa/src/astronomy/coordinates/constellation'
import { satelliteLookAngles } from 'nebulosa/src/astronomy/events/satellite'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { AU_KM } from 'nebulosa/src/core/constants'
import { errorResponse } from './http'
import { CELESTRAK_GROUPS, celestrakSourceKey } from './satellites.celestrak'
import { normalizeImport, type RejectedRecord } from './satellites.elements'
import { type SatelliteElementsRef, type SatelliteEphemeris, type SatelliteEphemerisTable, type SatelliteOrbitSummary, type SatellitePasses, type SatellitePosition, type SatelliteQuality, type SatelliteTrack, SATELLITE_LIMITS } from './satellites.ephemeris'
import { MANUAL_SOURCE_KEY, type SatelliteElementKind, type SatelliteElementSet, type SatelliteObjectType, type SatelliteSearchPage, type SatelliteSourceState, type SatelliteStore, type SatelliteSummary } from './satellites.store'
import { SatelliteRefreshError, type SatelliteRefreshErrorCode, type SatelliteSync } from './satellites.sync'
import { geographic, type SkyObserver, type SkyPosition } from './sky/ephemeris'
import { SkySatelliteError, type SkySatellites } from './sky/routes'
import type { SkySearchResult } from './sky/types'

// Artificial Satellites service: the catalog search, the details of an object, the downloads of CelesTrak sources an
// operator asks for, operator imports, and the predictions (position, passes, ephemeris, and the tracks the Sky map
// interpolates) of the element set each object uses. Predictions are read-only and stay in memory; the catalog is the
// database's. After every change of the catalog `satellites:changed` carries a new revision, so tabs read their
// snapshots again. Times are Unix milliseconds (UTC), angles radians, observers geodetic degrees and meters.

// Stable codes of the errors of the satellite routes:
// - notFound: the object, or the CelesTrak source, is unknown;
// - noElements: the object has no element set to predict with;
// - predictionUnreliable: the quality of the elements forbids the prediction (with `quality`);
// - computationFailed: SGP4 failed during the computation;
// - invalidImport: the imported text is neither OMM JSON nor TLE;
// - sourceCooldown, sourceBlocked, upstreamUnavailable, invalidResponse: see SatelliteRefreshErrorCode.
export type SatelliteErrorCode = 'noElements' | 'predictionUnreliable' | 'computationFailed' | 'invalidImport' | SatelliteRefreshErrorCode

// Event published after each change of the catalog: a download, an import, or a change of the element set an object
// uses.
export interface SatellitesChangedEvent {
	readonly type: 'satellites:changed'
	// Revision of the catalog in this process, increased by every change.
	readonly revision: number
}

// Downloads of an allowlisted CelesTrak group.
export interface SatelliteGroupStatus {
	// GROUP value of CelesTrak, such as STATIONS.
	readonly group: string
	// Description of the group.
	readonly label: string
	// Whether the group has thousands of objects, whose SATCAT is not downloaded with the elements.
	readonly large: boolean
	// Objects the group listed in its last GP download.
	readonly members: number
	// Download state of its GP elements and of its SATCAT metadata; absent when never attempted.
	readonly gp?: SatelliteSourceState
	readonly satcat?: SatelliteSourceState
	// Earliest instant of the next GP and SATCAT downloads, Unix milliseconds (UTC); 0 when allowed now.
	readonly gpAllowedAt: number
	readonly satcatAllowedAt: number
}

// Snapshot of the catalog sources (GET /api/satellites/sources).
export interface SatelliteSourcesSnapshot {
	// Revision of the catalog in this process.
	readonly revision: number
	// Allowlisted groups, in the order of the list.
	readonly groups: readonly SatelliteGroupStatus[]
	// Every source attempted, groups and single objects, by source key.
	readonly sources: readonly SatelliteSourceState[]
	// Objects with imported elements.
	readonly imported: number
	// Objects in the catalog.
	readonly objects: number
}

// Outcome of a download (POST /api/satellites/sources/:sourceKey/refresh).
export interface SatelliteRefreshResponse {
	// Downloads made: the source asked for, then the SATCAT of its group when it was downloaded along with it.
	readonly results: readonly { readonly sourceKey: string; readonly records: number; readonly rejected: number }[]
	// Sources after the downloads.
	readonly snapshot: SatelliteSourcesSnapshot
}

// Details of an object (GET /api/satellites/:noradId).
export interface SatelliteDetails {
	// Identity, metadata, and groups.
	readonly object: SatelliteSummary
	// Element set the predictions use; absent for a metadata-only object.
	readonly elements?: SatelliteElementsRef
	// Mean elements and derived orbit of that set.
	readonly orbit?: SatelliteOrbitSummary
	// Every element set of the object, GP first.
	readonly elementSets: readonly SatelliteElementsRef[]
}

// Body of POST /api/satellites/:noradId/position.
export interface SatellitePositionRequest {
	// Instant, Unix milliseconds (UTC).
	readonly time: number
	// Observer; absent for the Earth's center.
	readonly observer?: SkyObserver
}

// Answer of POST /api/satellites/:noradId/position.
export interface SatellitePositionResponse {
	readonly position: SatellitePosition
	readonly elements: SatelliteElementsRef
	readonly quality: SatelliteQuality
}

// Body of POST /api/satellites/:noradId/passes.
export interface SatellitePassesRequest {
	// Observer.
	readonly observer: SkyObserver
	// Window, Unix milliseconds (UTC); the tool keeps it within 7 days.
	readonly start: number
	readonly end: number
	// Minimum geometric altitude of the passes, radians.
	readonly minAltitude: number
	// Largest geometric altitude of the observer's Sun for a visible part, radians.
	readonly maxSunAltitude: number
}

// Answer of POST /api/satellites/:noradId/passes.
export interface SatellitePassesResponse extends SatellitePasses {
	readonly elements: SatelliteElementsRef
	readonly quality: SatelliteQuality
}

// Body of POST /api/satellites/:noradId/ephemeris.
export interface SatelliteEphemerisRequest {
	// Window, Unix milliseconds (UTC).
	readonly start: number
	readonly end: number
	// Step between rows, milliseconds, at least 1000.
	readonly step: number
	// Observer; absent for the Earth's center.
	readonly observer?: SkyObserver
}

// Answer of POST /api/satellites/:noradId/ephemeris.
export interface SatelliteEphemerisResponse extends SatelliteEphemerisTable {
	readonly elements: SatelliteElementsRef
	readonly quality: SatelliteQuality
}

// Body of POST /api/satellites/tracks.
export interface SatelliteTracksRequest {
	// Objects to sample; with `group`, the group's members are added.
	readonly ids?: readonly string[]
	// Source key of a group whose members above the observer's horizon at `start` are added, highest first (the first
	// ones by NORAD id without an observer).
	readonly group?: string
	// Observer; absent for the Earth's center.
	readonly observer?: SkyObserver
	// Window and step, Unix milliseconds (UTC) and milliseconds.
	readonly start: number
	readonly end: number
	readonly step: number
}

// Track of one object, or why it has none.
export type SatelliteTrackEntry = { readonly noradId: string; readonly name: string; readonly elements: SatelliteElementsRef; readonly quality: SatelliteQuality; readonly track: SatelliteTrack } | { readonly noradId: string; readonly name?: string; readonly code: 'notFound' | 'noElements' | 'computationFailed' }

// Answer of POST /api/satellites/tracks: at most SATELLITE_LIMITS.seriesObjects objects, the ids first.
export interface SatelliteTracksResponse {
	readonly tracks: readonly SatelliteTrackEntry[]
}

// Body of POST /api/satellites/import.
export interface SatelliteImportRequest {
	// OMM JSON (an object or a list) or TLE text (two lines per set, optionally after a name line).
	readonly text: string
}

// Answer of POST /api/satellites/import.
export interface SatelliteImportResponse {
	// Objects whose elements were imported, now used by their predictions.
	readonly imported: readonly { readonly noradId: string; readonly name: string; readonly epoch: number }[]
	// Records left out and why.
	readonly rejected: readonly RejectedRecord[]
}

// Body of PUT /api/satellites/:noradId/element-source.
export interface SatelliteElementSourceRequest {
	// Element set the predictions use; null for GP, then imported.
	readonly kind: SatelliteElementKind | null
}

// Error raised by the service, answered by the routes with its code.
export class SatelliteError extends Error {
	// Creates the error; details are the extra fields of its body.
	constructor(
		message: string,
		readonly status: number,
		readonly code: SatelliteErrorCode | 'notFound',
		readonly details?: object,
	) {
		super(message)
	}
}

// Satellite catalog and predictions.
export class SatelliteService {
	#revision = 0

	// Creates the service over its catalog, downloads, and predictions; `publish` receives the events.
	constructor(
		readonly store: SatelliteStore,
		readonly sync: SatelliteSync,
		readonly ephemeris: SatelliteEphemeris,
		private readonly publish: (event: SatellitesChangedEvent) => void,
	) {}

	// Publishes a change of the catalog with its new revision. Called by the downloads after each publication.
	changed() {
		this.publish({ type: 'satellites:changed', revision: ++this.#revision })
	}

	// Searches the catalog (no download, no prediction).
	search(query: Parameters<SatelliteStore['search']>[0]): SatelliteSearchPage {
		return this.store.search(query)
	}

	// Returns the snapshot of the sources.
	snapshot(): SatelliteSourcesSnapshot {
		const sources = this.store.sources()
		const byKey = new Map(sources.map((source) => [source.sourceKey, source]))
		const sizes = new Map(this.store.groups().map((group) => [group.sourceKey, group.members]))
		const now = Date.now()
		const allowedAt = (key: string) => {
			const next = this.sync.nextAllowedAt(key)
			return next > now ? next : 0
		}

		const groups = CELESTRAK_GROUPS.map(({ group, label, ...rest }): SatelliteGroupStatus => {
			const gp = celestrakSourceKey('gp', 'GROUP', group)
			const satcat = celestrakSourceKey('satcat', 'GROUP', group)
			return { group, label, large: 'large' in rest && rest.large, members: sizes.get(gp) ?? 0, gp: byKey.get(gp), satcat: byKey.get(satcat), gpAllowedAt: allowedAt(gp), satcatAllowedAt: allowedAt(satcat) }
		})

		return { revision: this.#revision, groups, sources, imported: sizes.get(MANUAL_SOURCE_KEY) ?? 0, objects: this.store.search({ limit: 1 }).total }
	}

	// Downloads a source; for the GP elements of a group that is not large, also its SATCAT when allowed, whose failure
	// never fails the download asked for. Rejects with SatelliteRefreshError.
	async refresh(sourceKey: string): Promise<SatelliteRefreshResponse> {
		const first = await this.sync.refresh(sourceKey)
		const results = [{ sourceKey: first.source.sourceKey, records: first.records, rejected: first.rejected }]
		const [provider, type, group] = first.source.sourceKey.split(':')
		const entry = CELESTRAK_GROUPS.find((candidate) => candidate.group === group)

		if (provider === 'gp' && type === 'GROUP' && entry && !('large' in entry)) {
			const satcat = celestrakSourceKey('satcat', 'GROUP', group)

			if (this.sync.nextAllowedAt(satcat) <= Date.now()) {
				try {
					const second = await this.sync.refresh(satcat)
					results.push({ sourceKey: satcat, records: second.records, rejected: second.rejected })
				} catch (error) {
					if (!(error instanceof SatelliteRefreshError)) throw error
				}
			}
		}

		return { results, snapshot: this.snapshot() }
	}

	// Imports OMM JSON or TLE text as the element sets of their objects, which their predictions then use. Throws
	// invalidImport when the text holds neither.
	import(text: string): SatelliteImportResponse {
		const batch = normalizeImport(text)
		if (!batch) throw new SatelliteError('The text is neither OMM JSON nor TLE', 422, 'invalidImport')

		if (batch.records.length > 0) {
			const at = Date.now()
			this.store.publish({
				sourceKey: MANUAL_SOURCE_KEY,
				objects: batch.records.map(({ noradId, name, cosparId }) => ({ noradId, name, cosparId, elementSource: 'manual' })),
				elements: batch.records.map(({ noradId, epoch, omm, digest }) => ({ noradId, kind: 'manual', sourceKey: MANUAL_SOURCE_KEY, epoch, omm, digest, fetchedAt: at })),
				at,
			})
			this.changed()
		}

		return { imported: batch.records.map(({ noradId, name, epoch }) => ({ noradId, name, epoch })), rejected: batch.rejected }
	}

	// Sets the element set an object uses. Throws notFound for an unknown object.
	setElementSource(noradId: string, kind: SatelliteElementKind | undefined) {
		if (!this.store.setElementSource(noradId, kind)) throw new SatelliteError(`Satellite ${noradId} is not in the catalog`, 404, 'notFound')
		this.changed()
	}

	// Returns the details of an object. Throws notFound for an unknown object.
	details(noradId: string): SatelliteDetails {
		const object = this.#object(noradId)
		const elements = this.store.elements(noradId)
		const elementSets = this.store.elementSets(noradId).map((set) => this.ephemeris.elementsRef(set))
		return elements ? { object, elements: this.ephemeris.elementsRef(elements), orbit: this.ephemeris.orbit(elements), elementSets } : { object, elementSets }
	}

	// Computes the position of an object at an instant. Throws notFound, noElements, or predictionUnreliable when SGP4
	// fails.
	position(noradId: string, { time, observer }: SatellitePositionRequest): SatellitePositionResponse {
		const object = this.#object(noradId)
		const elements = this.#elements(noradId)

		try {
			const position = this.ephemeris.position(elements, time, observer)
			return { position, elements: this.ephemeris.elementsRef(elements), quality: this.ephemeris.quality(elements, [time], object.decayDate) }
		} catch (error) {
			throw this.#unreliable(elements, [time], object, error)
		}
	}

	// Finds the passes of an object over an observer. Throws notFound, noElements, or predictionUnreliable when the
	// quality of the elements is unavailable over the window or SGP4 fails; rejects with the abort reason when `signal`
	// aborts.
	async passes(noradId: string, request: SatellitePassesRequest, signal?: AbortSignal): Promise<SatellitePassesResponse> {
		const object = this.#object(noradId)
		const elements = this.#elements(noradId)
		const times = [request.start, request.end]
		const quality = this.ephemeris.quality(elements, times, object.decayDate)
		if (quality.suitability === 'unavailable') throw new SatelliteError(`The elements of ${object.name} cannot predict passes in this window`, 422, 'predictionUnreliable', { quality })

		try {
			const passes = await this.ephemeris.passes(elements, request.observer, request.start, request.end, { minAltitude: request.minAltitude, maxSunAltitude: request.maxSunAltitude }, signal)
			return { ...passes, elements: this.ephemeris.elementsRef(elements), quality }
		} catch (error) {
			if (signal?.aborted) throw error
			throw this.#unreliable(elements, times, object, error)
		}
	}

	// Samples the ephemeris of an object. Throws notFound, noElements, or predictionUnreliable when SGP4 fails; rejects
	// with the abort reason when `signal` aborts.
	async ephemerisOf(noradId: string, request: SatelliteEphemerisRequest, signal?: AbortSignal): Promise<SatelliteEphemerisResponse> {
		const object = this.#object(noradId)
		const elements = this.#elements(noradId)
		const times = [request.start, request.end]

		try {
			const table = await this.ephemeris.ephemeris(elements, request.start, request.end, request.step, request.observer, signal)
			return { ...table, elements: this.ephemeris.elementsRef(elements), quality: this.ephemeris.quality(elements, times, object.decayDate) }
		} catch (error) {
			if (signal?.aborted) throw error
			throw this.#unreliable(elements, times, object, error)
		}
	}

	// Samples the tracks of objects for the Sky map: the ids asked for, then the members of a group above the horizon,
	// at most SATELLITE_LIMITS.seriesObjects objects and SATELLITE_LIMITS.seriesSamples samples in all. An object that
	// cannot be sampled is answered with its code.
	tracks(request: SatelliteTracksRequest): SatelliteTracksResponse {
		const ids = [...new Set([...(request.ids ?? []), ...(request.group ? this.#visibleMembers(request.group, request.start, request.observer) : [])])].slice(0, SATELLITE_LIMITS.seriesObjects)
		const perObject = Math.max(1, Math.floor(SATELLITE_LIMITS.seriesSamples / Math.max(1, ids.length)))
		const times = [request.start, request.end]

		const tracks = ids.map((noradId): SatelliteTrackEntry => {
			const object = this.store.object(noradId)
			if (!object) return { noradId, code: 'notFound' }
			const elements = this.store.elements(noradId)
			if (!elements) return { noradId, name: object.name, code: 'noElements' }

			try {
				const track = this.ephemeris.track(elements, request.start, request.end, request.step, perObject, request.observer)
				return { noradId, name: object.name, elements: this.ephemeris.elementsRef(elements), quality: this.ephemeris.quality(elements, times, object.decayDate), track }
			} catch {
				return { noradId, name: object.name, code: 'computationFailed' }
			}
		})

		return { tracks }
	}

	// Members of a group to draw: with an observer, those above its horizon at `time`, highest first; without one, the
	// first ones by NORAD id. Uses the look angles alone, the cheapest SGP4 geometry, since a group can have thousands.
	#visibleMembers(group: string, time: number, observer: SkyObserver | undefined) {
		const members = this.store.members(group)
		if (!observer) return members.slice(0, SATELLITE_LIMITS.seriesObjects)
		const site = geographic(observer)
		const t = timeUnix(time / 1000, true)
		const visible: { readonly noradId: string; readonly altitude: number }[] = []

		for (const noradId of members) {
			const elements = this.store.elements(noradId)
			if (!elements) continue

			try {
				const { altitude } = satelliteLookAngles(this.ephemeris.record(elements), site, t)
				if (altitude > 0) visible.push({ noradId, altitude })
			} catch {
				// An object SGP4 cannot place is not drawn.
			}
		}

		return visible
			.sort((a, b) => b.altitude - a.altitude)
			.slice(0, SATELLITE_LIMITS.seriesObjects)
			.map((entry) => entry.noradId)
	}

	// Returns an object, or throws notFound.
	#object(noradId: string) {
		const object = this.store.object(noradId)
		if (!object) throw new SatelliteError(`Satellite ${noradId} is not in the catalog`, 404, 'notFound')
		return object
	}

	// Returns the element set an object uses, or throws noElements.
	#elements(noradId: string) {
		const elements = this.store.elements(noradId)
		if (!elements) throw new SatelliteError(`Satellite ${noradId} has no orbital elements`, 404, 'noElements')
		return elements
	}

	// Error of a prediction SGP4 could not compute, with the quality of its elements.
	#unreliable(elements: SatelliteElementSet, times: readonly number[], object: SatelliteSummary, error: unknown) {
		if (error instanceof SatelliteError) return error
		const quality = this.ephemeris.quality(elements, times, object.decayDate, true)
		return new SatelliteError(`The elements of ${object.name} cannot be propagated to this time: ${error instanceof Error ? error.message : String(error)}`, 422, 'predictionUnreliable', { quality })
	}
}

// Names of the SATCAT object types in Sky search results.
const OBJECT_TYPE_NAMES: Readonly<Record<SatelliteObjectType, string>> = { payload: 'Payload', rocketBody: 'Rocket body', debris: 'Debris', unknown: 'Artificial satellite' }

// Converts a satellite position to the Sky's: the RA/Dec of date and J2000, the refracted altitude the Sky shows, and the
// distance in AU; no magnitude, illuminated fraction, or elongation.
function skyPositionOf(position: SatellitePosition): SkyPosition {
	const code = position.constellation as Constellation
	return {
		time: position.time,
		source: 'local',
		center: position.center,
		rightAscension: position.rightAscension,
		declination: position.declination,
		rightAscensionJ2000: position.rightAscensionJ2000,
		declinationJ2000: position.declinationJ2000,
		azimuth: position.azimuth,
		altitude: position.apparentAltitude,
		distance: position.distanceKm / AU_KM,
		constellation: code,
		constellationName: CONSTELLATIONS[code]?.name,
	}
}

// Satellites of the service as the Sky searches and locates them: search results with their `satellite` reference, and
// positions in the Sky's form, a failure raised as the Sky's error with its status and code.
export function satelliteSkyAdapter(service: SatelliteService): SkySatellites {
	return {
		search: (text, limit) =>
			service.search({ text, limit }).items.map((item): SkySearchResult => ({
				ref: { kind: 'satellite', noradId: item.noradId },
				name: item.name,
				designations: item.cosparId ? [`NORAD ${item.noradId}`, item.cosparId] : [`NORAD ${item.noradId}`],
				category: 'satellite',
				typeName: OBJECT_TYPE_NAMES[item.objectType ?? 'unknown'],
			})),
		position: (noradId, time, observer) => {
			try {
				return skyPositionOf(service.position(noradId, { time, observer }).position)
			} catch (error) {
				if (error instanceof SatelliteError) throw new SkySatelliteError(error.message, error.status, error.code)
				throw error
			}
		},
	}
}

// Answers a failure of the service with its code; any other error is thrown again.
function failure(error: unknown) {
	if (error instanceof SatelliteError) return errorResponse(error.message, error.status, error.code, error.details)

	if (error instanceof SatelliteRefreshError) {
		const status = error.code === 'notFound' ? 404 : error.code === 'sourceCooldown' || error.code === 'sourceBlocked' ? 409 : 502
		return errorResponse(error.message, status, error.code, error.source && { source: error.source })
	}

	throw error
}

// Runs a route handler, answering the failures of the service.
async function handle(run: () => Response | Promise<Response>) {
	try {
		return await run()
	} catch (error) {
		return failure(error)
	}
}

// Reads the NORAD id of a route.
function noradIdOf(req: { readonly params: Readonly<Record<string, string>> }) {
	return decodeURIComponent(req.params.noradId)
}

// Creates the satellite routes.
export function createSatelliteRoutes(service: SatelliteService) {
	return {
		'/api/satellites': {
			// Page of the catalog (SatelliteSearchPage) for ?q&group&type&status&ids (comma-separated)&offset&limit.
			GET: (req) => {
				const params = new URL(req.url).searchParams
				const ids = params.get('ids')
				return Response.json(
					service.search({
						text: params.get('q') ?? undefined,
						group: params.get('group') ?? undefined,
						objectType: (params.get('type') as SatelliteObjectType | null) ?? undefined,
						opsStatus: params.get('status') ?? undefined,
						ids: ids === null ? undefined : ids.split(',').filter(Boolean),
						offset: +(params.get('offset') ?? 0),
						limit: +(params.get('limit') ?? 50),
					}) satisfies SatelliteSearchPage,
				)
			},
		},
		'/api/satellites/sources': {
			// Snapshot of the sources (SatelliteSourcesSnapshot).
			GET: () => Response.json(service.snapshot() satisfies SatelliteSourcesSnapshot),
		},
		'/api/satellites/sources/:sourceKey/refresh': {
			// Downloads a source (SatelliteRefreshResponse); 404 notFound outside the allowlist, 409 sourceCooldown or
			// sourceBlocked with `source`, 502 upstreamUnavailable or invalidResponse with `source`.
			POST: (req) => handle(async () => Response.json((await service.refresh(decodeURIComponent(req.params.sourceKey))) satisfies SatelliteRefreshResponse)),
		},
		'/api/satellites/import': {
			// Imports OMM JSON or TLE text (SatelliteImportRequest, SatelliteImportResponse); 422 invalidImport.
			POST: (req) => handle(async () => Response.json(service.import(((await req.json()) as SatelliteImportRequest).text) satisfies SatelliteImportResponse)),
		},
		'/api/satellites/tracks': {
			// Sampled tracks for the Sky map (SatelliteTracksRequest, SatelliteTracksResponse).
			POST: async (req) => Response.json(service.tracks((await req.json()) as SatelliteTracksRequest) satisfies SatelliteTracksResponse),
		},
		'/api/satellites/:noradId': {
			// Details of an object (SatelliteDetails); 404 notFound.
			GET: (req) => handle(() => Response.json(service.details(noradIdOf(req)) satisfies SatelliteDetails)),
		},
		'/api/satellites/:noradId/element-source': {
			// Sets the element set an object uses (SatelliteElementSourceRequest); 204, or 404 notFound.
			PUT: (req) =>
				handle(async () => {
					service.setElementSource(noradIdOf(req), ((await req.json()) as SatelliteElementSourceRequest).kind ?? undefined)
					return new Response(null, { status: 204 })
				}),
		},
		'/api/satellites/:noradId/position': {
			// Position at an instant (SatellitePositionRequest, SatellitePositionResponse); 404 notFound or noElements, 422
			// predictionUnreliable.
			POST: (req) => handle(async () => Response.json(service.position(noradIdOf(req), (await req.json()) as SatellitePositionRequest) satisfies SatellitePositionResponse)),
		},
		'/api/satellites/:noradId/passes': {
			// Passes over an observer (SatellitePassesRequest, SatellitePassesResponse); 404 notFound or noElements, 422
			// predictionUnreliable with `quality`.
			POST: (req) => handle(async () => Response.json((await service.passes(noradIdOf(req), (await req.json()) as SatellitePassesRequest, req.signal)) satisfies SatellitePassesResponse)),
		},
		'/api/satellites/:noradId/ephemeris': {
			// Sampled ephemeris (SatelliteEphemerisRequest, SatelliteEphemerisResponse); 404 notFound or noElements, 422
			// predictionUnreliable.
			POST: (req) => handle(async () => Response.json((await service.ephemerisOf(noradIdOf(req), (await req.json()) as SatelliteEphemerisRequest, req.signal)) satisfies SatelliteEphemerisResponse)),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
