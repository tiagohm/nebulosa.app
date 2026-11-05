import { GuideOutputCommander } from 'nebulosa/src/devices/commanders/guideoutput'
import type { GuideDirection, GuideOutput } from 'nebulosa/src/devices/indi/device'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { admissionResponse, busy, type ClientResolver, type CommandRequest, disconnected, findDevice, notFound, settle, startCommand, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import type { OperationDevice, OperationRegistry } from './operations'

// Manual pulse guiding of the guide outputs of every open connection: a standalone guider, or the
// pulse-guide interface of a mount or a camera. A pulse runs as a guideOutput.pulse operation holding the
// physical device and, when the request names it, the mount the guide output drives (the MOUNT of the Equipment Setup
// whose GUIDE_OUTPUT it is), atomically, so it is refused while a slew, a nudge, or a capture holds the same mount or
// camera, even when the guide output is the ST4 port of a camera that shares no device with the mount, and resolves
// only once the device reports the pulse ended. Stopping zeroes the pulses of this output only;
// it never cancels another operation of the device behind it.

// Every guide direction, for stopping all pulses at once.
const DIRECTIONS: readonly GuideDirection[] = ['NORTH', 'SOUTH', 'WEST', 'EAST']

// Body of POST /api/connections/:id/guide-outputs/:deviceId/pulse.
export interface GuidePulseRequest extends CommandRequest {
	// Direction of the pulse, along the driver's motion vectors.
	readonly direction: GuideDirection
	// Duration of the pulse in milliseconds.
	readonly duration: number
	// Mount the guide output drives (the MOUNT of the Equipment Setup whose GUIDE_OUTPUT it is), held with it for the
	// pulse; absent for a guide output the setup does not assign.
	readonly mount?: OperationDevice
}

// Body of POST /api/connections/:id/guide-outputs/:deviceId/guide-rate.
export interface GuideRateRequest {
	// Right ascension guide rate as a fraction of the sidereal rate.
	readonly rightAscension: number
	// Declination guide rate as a fraction of the sidereal rate.
	readonly declination: number
}

// Pulse-guide commands over the guide outputs of every open connection.
export class GuideOutputCommands implements Disposable {
	// Commander driving the guide outputs and observing their pulses.
	readonly #commander: GuideOutputCommander

	// Creates the commands over the device registry; client resolves an open connection id to its client and
	// operations runs and publishes every pulse.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
	) {
		this.#commander = new GuideOutputCommander(devices.guideOutputs, operations.arbiter)
	}

	// Commander of the guide outputs, shared with the guiding sessions, whose pulses it dispatches and observes.
	get commander() {
		return this.#commander
	}

	// Responds with the state of a guide output, or 404 when the connection is not open or has no such output.
	state(connectionId: string, deviceId: string): Response {
		const client = this.client(connectionId)
		const state = client && this.devices.state(client, 'guideOutput', deviceId)
		return state ? Response.json(state) : notFound('Guide output')
	}

	// Starts a pulse. Responds 202 with the operation id; 404 for an unknown output or mount, 409 when either is
	// disconnected or the device behind either is busy, 422 when the output cannot pulse.
	pulse(connectionId: string, deviceId: string, request: GuidePulseRequest): Response {
		const output = this.#connected(connectionId, deviceId)
		if (output instanceof Response) return output
		if (!output.canPulseGuide) return unsupported('The guide output cannot pulse')
		if (!request.mount) return startCommand(this.operations, 'guideOutput.pulse', connectionId, output, request, () => this.#commander.pulse(this.operations.coordinator, output, request.direction, request.duration))

		const mount = findDevice(this, request.mount.connectionId, 'mount', request.mount.deviceId)
		if (!mount) return notFound('Mount')
		if (!mount.connected) return disconnected('Mount')

		const known = this.operations.repeated(request.token)
		if (known) return admissionResponse({ ok: true, admission: known })
		if (!this.operations.available(output) || !this.operations.available(mount)) return busy()

		// The root takes both at once, and the pulse acquires the guide output again inside it.
		const resources = [output, mount].map((device) => ({ key: resourceKey(device), device }))
		const pulse = () => this.operations.coordinator.start('guidePulse', resources, (context) => this.#commander.pulse(context, output, request.direction, request.duration)).result
		return admissionResponse({ ok: true, admission: this.operations.admit('guideOutput.pulse', [{ connectionId, deviceId }, request.mount], request.token, pulse) })
	}

	// Sets the guide rates. Responds 204 once the driver reports it, 504 when it never does (the new rates arrive as a guideOutput:updated event); 404,
	// 409 disconnected or busy, 422 when the rates cannot be set.
	async setGuideRate(connectionId: string, deviceId: string, { rightAscension, declination }: GuideRateRequest): Promise<Response> {
		const output = this.#connected(connectionId, deviceId)
		if (output instanceof Response) return output
		if (!output.canSetGuideRate) return unsupported('The guide output cannot set its guide rates')
		return await settle(this.#commander.setGuideRate(this.operations.coordinator, output, rightAscension, declination), 'Setting the guide rates')
	}

	// Stops every pulse of a guide output and resolves once it reports none. Responds 204, 404 for an
	// unknown output, and 409 when the stop could not be confirmed. The pulse operation itself ends when the
	// output reports the pulse ended.
	async stop(connectionId: string, deviceId: string): Promise<Response> {
		const output = findDevice(this, connectionId, 'guideOutput', deviceId)
		if (!output) return notFound('Guide output')
		return await settle(this.#commander.stopPulses(output, DIRECTIONS), 'Stopping the pulses')
	}

	// Returns the connected guide output with this id on an open connection, or the response refusing it.
	#connected(connectionId: string, deviceId: string): GuideOutput | Response {
		const output = findDevice(this, connectionId, 'guideOutput', deviceId)
		if (!output) return notFound('Guide output')
		if (!output.connected) return disconnected('Guide output')
		return output
	}

	// Stops observing the guide outputs; their operations belong to the operation registry.
	[Symbol.dispose]() {
		this.#commander.dispose()
	}
}

// Routes of the guide output commands.
export function createGuideOutputRoutes(guideOutputs: GuideOutputCommands) {
	return {
		'/api/connections/:id/guide-outputs/:deviceId': {
			// Pulse-guide state of a guide output; 404 when the connection is not open or has no such output.
			GET: (req) => guideOutputs.state(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/guide-outputs/:deviceId/pulse': {
			// Starts a guide pulse; the outcome arrives as operation:updated events.
			POST: async (req) => guideOutputs.pulse(req.params.id, req.params.deviceId, (await req.json()) as GuidePulseRequest),
		},
		'/api/connections/:id/guide-outputs/:deviceId/guide-rate': {
			// Sets the guide rates; the new rates arrive as a guideOutput:updated event.
			POST: async (req) => guideOutputs.setGuideRate(req.params.id, req.params.deviceId, (await req.json()) as GuideRateRequest),
		},
		'/api/connections/:id/guide-outputs/:deviceId/stop': {
			// Stops every pulse of a guide output.
			POST: (req) => guideOutputs.stop(req.params.id, req.params.deviceId),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
