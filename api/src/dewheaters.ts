import { DewHeaterCommander } from 'nebulosa/src/devices/commanders/dewheater'
import { type ClientResolver, connectedDevice, settle, stateResponse, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import type { OperationRegistry } from './operations'

// Dew heater commands of every open connection, over the toolkit's DewHeaterCommander: setting the duty
// cycle, which the driver applies at once. A dew heater is the heater channel of a device such as a
// motorized cover, so the command acquires that physical device and is refused while it moves.

// Body of POST /api/connections/:id/dew-heaters/:deviceId/duty-cycle.
export interface DewHeaterDutyCycleRequest {
	// Duty cycle in the driver's own PWM units; the commander keeps it inside the range the heater publishes.
	readonly value: number
}

// Dew heater commands over the heaters of every open connection.
export class DewHeaterCommands {
	// Commander driving the heaters.
	readonly #commander: DewHeaterCommander

	// Creates the commands over the device registry; client resolves an open connection id to its client and
	// operations arbitrates every command.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
	) {
		this.#commander = new DewHeaterCommander(devices.dewHeaters)
	}

	// Responds with the state of a dew heater, or 404.
	state(connectionId: string, deviceId: string): Response {
		return stateResponse(this.devices, this.client, connectionId, 'dewHeater', deviceId, 'Dew heater')
	}

	// Sets the duty cycle. Responds 204 once sent (the new value arrives as a dewHeater:updated event); 404,
	// 409 disconnected or busy, 422 when the heater channel is gone.
	async setDutyCycle(connectionId: string, deviceId: string, { value }: DewHeaterDutyCycleRequest): Promise<Response> {
		const heater = connectedDevice(this.devices, this.client, connectionId, 'dewHeater', deviceId, 'Dew heater')
		if (heater instanceof Response) return heater
		if (!heater.hasDewHeater) return unsupported('The device has no dew heater')
		return await settle(this.#commander.dutyCycle(this.operations.coordinator, heater, value), 'Setting the duty cycle')
	}
}

// Routes of the dew heater commands.
export function createDewHeaterRoutes(dewHeaters: DewHeaterCommands) {
	return {
		'/api/connections/:id/dew-heaters/:deviceId': {
			// Heating level of a dew heater; 404 when the connection is not open or has no such heater.
			GET: (req) => dewHeaters.state(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/dew-heaters/:deviceId/duty-cycle': {
			// Sets the duty cycle; the new value arrives as a dewHeater:updated event.
			POST: async (req) => dewHeaters.setDutyCycle(req.params.id, req.params.deviceId, (await req.json()) as DewHeaterDutyCycleRequest),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
