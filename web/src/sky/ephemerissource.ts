import type { EphemerisAttempt, EphemerisSkipReason, SkyPositionSource } from 'api'

// Words for the ephemeris chain of the server (api/src/ephemeris.chain.ts): the source a position came from and why the
// sources tried before it did not give it, shared by every view that says where a position came from.

// Name of each source of a position, as the end of "from …".
const SOURCE_NAMES: Readonly<Record<SkyPositionSource, string>> = { spk: 'the SPK kernels', horizons: 'JPL Horizons', analytical: 'the analytical theories', catalog: 'the catalog astrometry', sgp4: 'the SGP4 propagation of its elements' }

// Short name of each source of the chain, as the subject of a reason.
const ATTEMPT_NAMES: Readonly<Record<EphemerisAttempt['source'], string>> = { spk: 'SPK', horizons: 'Horizons', analytical: 'Theories' }

// Words of each reason a source did not give a position.
export const EPHEMERIS_SKIP_REASONS: Readonly<Record<EphemerisSkipReason, string>> = {
	loading: 'still being opened',
	noKernel: 'no kernel enabled',
	targetMissing: 'no kernel has the object',
	missingCenter: 'a body it depends on is missing',
	outOfCoverage: 'outside the coverage',
	unsupportedFrame: 'unsupported frame',
	unsupportedType: 'unsupported data type',
	cycle: 'a kernel chain never ends',
	kernelReadFailed: 'a kernel could not be read',
	noModel: 'no theory for the object',
	offline: 'offline',
	timeout: 'did not answer in time',
	network: 'cannot be reached',
	breakerOpen: 'paused after repeated failures',
}

// Source of a position as the end of "from …", with the sources tried before in parentheses, such as "JPL Horizons
// (SPK: no kernel enabled)".
export function describeEphemerisSource(source: SkyPositionSource, attempts: readonly EphemerisAttempt[] | undefined) {
	const tried = attempts?.map((attempt) => `${ATTEMPT_NAMES[attempt.source]}: ${EPHEMERIS_SKIP_REASONS[attempt.reason]}`).join('; ')
	return tried ? `${SOURCE_NAMES[source]} (${tried})` : SOURCE_NAMES[source]
}
