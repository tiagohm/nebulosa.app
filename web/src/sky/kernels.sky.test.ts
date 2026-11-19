import { expect, test } from 'bun:test'
import type { SpiceKernelSummary } from 'api'
import { isCometSpkId, kernelBodies, kernelBodyName } from './kernels.sky'

function kernel(fields: Partial<SpiceKernelSummary>): SpiceKernelSummary {
	return { id: 'k', sha256: '', name: '', sourceKind: 'horizons', bytes: 0, createdAt: 0, enabled: true, priority: 0, state: 'ready', readiness: 'ready', targets: [], segmentCount: 1, unsupportedSegments: 0, ...fields }
}

test('comets are told by their SPK-ID', () => {
	expect(isCometSpkId('1000042')).toBe(true)
	expect(isCometSpkId('1999999')).toBe(true)
	expect(isCometSpkId('20000001')).toBe(false)
	expect(isCometSpkId('2000433')).toBe(false)
	expect(isCometSpkId('54000001')).toBe(false)
})

test('the designation drops the SPK-ID the library appends to a generated kernel', () => {
	expect(kernelBodyName({ name: '161P/Hartley-IRAS (1000042)', sourceRef: '1000042' })).toBe('161P/Hartley-IRAS')
	expect(kernelBodyName({ name: '1000042', sourceRef: '1000042' })).toBe('1000042')
	expect(kernelBodyName({ name: 'Ceres (2021)', sourceRef: '20000001' })).toBe('Ceres (2021)')
})

test('the Sky draws the small bodies of the Horizons kernels the ephemeris may use, once each', () => {
	const bodies = kernelBodies([
		kernel({ name: 'de440s.bsp', sourceKind: 'naif', sourceRef: 'de440s' }),
		kernel({ name: '161P/Hartley-IRAS (1000042)', sourceRef: '1000042' }),
		kernel({ name: '161P/Hartley-IRAS (1000042)', sourceRef: '1000042', readiness: 'missingDependency' }),
		kernel({ name: '1 Ceres (20000001)', sourceRef: '20000001', readiness: 'missingDependency' }),
		kernel({ name: '4 Vesta (20000004)', sourceRef: '20000004', enabled: false, readiness: 'disabled' }),
		kernel({ name: '433 Eros (20000433)', sourceRef: '20000433', readiness: 'invalid' }),
		kernel({ name: 'upload.bsp', sourceKind: 'import' }),
	])

	expect(bodies).toEqual([
		{ spkId: '1000042', name: '161P/Hartley-IRAS', comet: true },
		{ spkId: '20000001', name: '1 Ceres', comet: false },
	])
	expect(kernelBodies(undefined)).toEqual([])
})
