import { join } from 'path'
import type { IndiClientHandler } from 'nebulosa/src/devices/indi/client'
import type { FocuserManager } from 'nebulosa/src/devices/indi/manager/focuser'
import type { GuideOutputManager } from 'nebulosa/src/devices/indi/manager/guideoutput'
import type { MountManager } from 'nebulosa/src/devices/indi/manager/mount'
import type { RotatorManager } from 'nebulosa/src/devices/indi/manager/rotator'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { CoverSimulator } from 'nebulosa/src/devices/indi/simulator/cover'
import { FlatPanelSimulator } from 'nebulosa/src/devices/indi/simulator/flatpanel'
import { FocuserSimulator } from 'nebulosa/src/devices/indi/simulator/focuser'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { RotatorSimulator } from 'nebulosa/src/devices/indi/simulator/rotator'
import type { DeviceSimulatorOptions } from 'nebulosa/src/devices/indi/simulator/types'
import { WheelSimulator } from 'nebulosa/src/devices/indi/simulator/wheel'
import type { ConnectionStart } from './connection.start'
import { simulatorCatalogSources } from './simulator.catalog'

// Composes the in-process simulator's devices, catalog sources and app-directory persistence.
// The owning connection handler disposes the client and all registered devices on startup failure or disconnect.

// Simulator dependencies supplied once by the runtime composition root.
export interface SimulatorConnectionOptions {
	// Directory holding optional HNSKY archives and per-device JSON configuration.
	readonly appDir: string
	// Receives device definitions and property changes.
	readonly handler: IndiClientHandler
	// Supplies mount pointing for both cameras.
	readonly mountManager: MountManager
	// Supplies focus position for both cameras.
	readonly focuserManager: FocuserManager
	// Supplies camera field rotation.
	readonly rotatorManager: RotatorManager
	// Supplies guiding pulses for the synthetic exposures.
	readonly guideOutputManager: GuideOutputManager
}

// Prepares a fresh simulator client; start detects catalogs and constructs its devices exactly once.
// No devices are published before catalog discovery succeeds. File contents are loaded by the selected source.
export function startSimulatorConnection(options: SimulatorConnectionOptions): ConnectionStart {
	const { appDir, handler, mountManager, focuserManager, rotatorManager, guideOutputManager } = options
	const client = new ClientSimulator('client.simulator', handler)

	// Persists properties for a simulator-owned device name under appDir; returns the number of bytes written.
	function save(name: string, properties: unknown) {
		return Bun.write(join(appDir, `${name}.config.json`), JSON.stringify(properties))
	}

	// Loads stored property vectors for a simulator-owned name, or an empty list when no file exists.
	async function load(name: string) {
		const file = Bun.file(join(appDir, `${name}.config.json`))
		return (await file.exists()) ? file.json() : []
	}

	// Registers all devices after catalog discovery. The client owns even partially constructed devices.
	async function start() {
		const catalogSources = await simulatorCatalogSources(appDir)
		const persistence: DeviceSimulatorOptions = { save, load }
		const cameraOptions = { ...persistence, mountManager, guideOutputManager, focuserManager, rotatorManager, catalogSources }
		const mount = new MountSimulator('Mount Simulator', client, persistence)
		const camera = new CameraSimulator('Camera Simulator', client, cameraOptions)
		const guideCamera = new CameraSimulator('Guide Camera Simulator', client, cameraOptions)
		const focuser = new FocuserSimulator('Focuser Simulator', client, persistence)
		const wheel = new WheelSimulator('Wheel Simulator', client, persistence)
		const rotator = new RotatorSimulator('Rotator Simulator', client, persistence)
		const flatPanel = new FlatPanelSimulator('Flat Panel Simulator', client, persistence)
		const cover = new CoverSimulator('Dust Cap Simulator', client, persistence)
		return true
	}

	return { client, start }
}
