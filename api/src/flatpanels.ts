import { FlatPanelCommander } from 'nebulosa/src/devices/commanders/flatpanel'
import { type ClientResolver, connectedDevice, settle, stateResponse } from './commands'
import type { DeviceRegistry } from './devices'
import type { OperationRegistry } from './operations'

// Flat panel commands of every open connection, over the toolkit's FlatPanelCommander: switching the light
// and setting its brightness, which the driver applies at once. Each command acquires the panel for its
// instant, so it is refused while another operation, such as a future flat sequence or the motion of the
// cover of the same flip-flat, holds the physical device. The light state is the one the panel reports,
// never inferred from the brightness.

// Body of POST /api/connections/:id/flat-panels/:deviceId/light.
export interface FlatPanelLightRequest {
	// Whether the light is to be on.
	readonly enabled: boolean
}

// Body of POST /api/connections/:id/flat-panels/:deviceId/intensity.
export interface FlatPanelIntensityRequest {
	// Brightness in the driver's own units; the commander keeps it inside the range the panel publishes.
	readonly value: number
}

// Flat panel commands over the panels of every open connection.
export class FlatPanelCommands {
	// Commander driving the panels.
	readonly #commander: FlatPanelCommander

	// Creates the commands over the device registry; client resolves an open connection id to its client and
	// operations arbitrates every command.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
	) {
		this.#commander = new FlatPanelCommander(devices.flatPanels)
	}

	// Responds with the state of a flat panel, or 404.
	state(connectionId: string, deviceId: string): Response {
		return stateResponse(this.devices, this.client, connectionId, 'flatPanel', deviceId, 'Flat panel')
	}

	// Switches the light. Responds 204 once sent (the new state arrives as a flatPanel:updated event); 404,
	// 409 disconnected or busy.
	async setLight(connectionId: string, deviceId: string, { enabled }: FlatPanelLightRequest): Promise<Response> {
		const panel = connectedDevice(this.devices, this.client, connectionId, 'flatPanel', deviceId, 'Flat panel')
		if (panel instanceof Response) return panel
		const { coordinator } = this.operations
		return await settle(enabled ? this.#commander.enable(coordinator, panel) : this.#commander.disable(coordinator, panel), 'Switching the light')
	}

	// Sets the brightness. Responds 204 once sent (the new value arrives as a flatPanel:updated event); 404,
	// 409 disconnected or busy.
	async setIntensity(connectionId: string, deviceId: string, { value }: FlatPanelIntensityRequest): Promise<Response> {
		const panel = connectedDevice(this.devices, this.client, connectionId, 'flatPanel', deviceId, 'Flat panel')
		if (panel instanceof Response) return panel
		return await settle(this.#commander.intensity(this.operations.coordinator, panel, value), 'Setting the brightness')
	}
}

// Routes of the flat panel commands.
export function createFlatPanelRoutes(flatPanels: FlatPanelCommands) {
	return {
		'/api/connections/:id/flat-panels/:deviceId': {
			// Light state of a flat panel; 404 when the connection is not open or has no such panel.
			GET: (req) => flatPanels.state(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/flat-panels/:deviceId/light': {
			// Switches the light; the new state arrives as a flatPanel:updated event.
			POST: async (req) => flatPanels.setLight(req.params.id, req.params.deviceId, (await req.json()) as FlatPanelLightRequest),
		},
		'/api/connections/:id/flat-panels/:deviceId/intensity': {
			// Sets the brightness; the new value arrives as a flatPanel:updated event.
			POST: async (req) => flatPanels.setIntensity(req.params.id, req.params.deviceId, (await req.json()) as FlatPanelIntensityRequest),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
