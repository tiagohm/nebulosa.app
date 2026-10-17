import { describe, expect, test } from 'bun:test'
import type { EquipmentSetup } from '../equipment/roles'
import type { CaptureSettings } from '../profile/profile'
import { cameraRole, cameraTabs, cameraView, captureRoute, resolveCameraView, viewMode, viewReticle } from './views'

const MAIN = { id: 'main', name: 'ASI2600MC Pro' }
const GUIDE = { id: 'guide', name: 'ASI120MM Mini' }

describe('tabs', () => {
	test('one tab per assigned camera role, in order', () => {
		expect(cameraTabs({ MAIN_CAMERA: MAIN })).toEqual(['MAIN_CAMERA'])
		expect(cameraTabs({ GUIDE_CAMERA: GUIDE, MOUNT: { id: 'm', name: '' } })).toEqual(['GUIDE_CAMERA'])
		expect(cameraTabs({ GUIDE_CAMERA: GUIDE, MAIN_CAMERA: MAIN })).toEqual(['MAIN_CAMERA', 'GUIDE_CAMERA'])
		expect(cameraTabs({ MOUNT: { id: 'm', name: '' } })).toEqual([])
	})

	test('maps camera roles to URL segments and back', () => {
		expect(cameraView('MAIN_CAMERA')).toBe('main')
		expect(cameraView('GUIDE_CAMERA')).toBe('guide')
		expect(cameraRole('guide')).toBe('GUIDE_CAMERA')
	})
})

describe('resolve', () => {
	const both: EquipmentSetup = { MAIN_CAMERA: MAIN, GUIDE_CAMERA: GUIDE }

	test('shows the requested camera when assigned', () => {
		expect(resolveCameraView(both, 'GUIDE_CAMERA', 'MAIN_CAMERA')).toBe('GUIDE_CAMERA')
	})

	test('falls back to the last selection, then to the first tab', () => {
		expect(resolveCameraView({ GUIDE_CAMERA: GUIDE }, 'MAIN_CAMERA', 'GUIDE_CAMERA')).toBe('GUIDE_CAMERA')
		expect(resolveCameraView({ GUIDE_CAMERA: GUIDE }, 'MAIN_CAMERA')).toBe('GUIDE_CAMERA')
		expect(resolveCameraView(both, undefined, 'GUIDE_CAMERA')).toBe('GUIDE_CAMERA')
		expect(resolveCameraView(both)).toBe('MAIN_CAMERA')
	})

	test('no camera gives no view', () => {
		expect(resolveCameraView({}, 'MAIN_CAMERA', 'GUIDE_CAMERA')).toBeUndefined()
	})
})

describe('preferences', () => {
	const capture: CaptureSettings = { activeCamera: 'GUIDE_CAMERA', views: { MAIN_CAMERA: { mode: 'camera' }, GUIDE_CAMERA: { mode: 'mount-nudge', reticle: false } } }

	test('each camera view keeps its own mode', () => {
		expect(viewMode(capture, 'MAIN_CAMERA')).toBe('camera')
		expect(viewMode(capture, 'GUIDE_CAMERA')).toBe('mount-nudge')
		expect(viewMode({ views: {} }, 'GUIDE_CAMERA')).toBe('camera')
	})

	test('the reticle follows the view choice, else the mode overlays', () => {
		expect(viewReticle(capture, 'GUIDE_CAMERA', 'mount-nudge')).toBe(false)
		expect(viewReticle(capture, 'MAIN_CAMERA', 'camera')).toBe(false)
		expect(viewReticle(capture, 'MAIN_CAMERA', 'polar-alignment')).toBe(true)
	})

	test('builds the capture route of a profile', () => {
		expect(captureRoute(capture, { MAIN_CAMERA: MAIN, GUIDE_CAMERA: GUIDE })).toEqual({ workspace: 'capture', camera: 'guide', mode: 'mount-nudge' })
		expect(captureRoute(capture, { MAIN_CAMERA: MAIN })).toEqual({ workspace: 'capture', camera: 'main', mode: 'camera' })
		expect(captureRoute(capture, { MAIN_CAMERA: MAIN, GUIDE_CAMERA: GUIDE }, 'focus-calibrator')).toEqual({ workspace: 'capture', camera: 'guide', mode: 'focus-calibrator' })
		expect(captureRoute({ views: {} }, {})).toEqual({ workspace: 'capture', camera: 'main', mode: 'camera' })
	})
})
