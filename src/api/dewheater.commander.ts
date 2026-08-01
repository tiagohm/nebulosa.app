import type { DewHeater } from 'nebulosa/src/devices/indi/device'
import type { DewHeaterManager } from 'nebulosa/src/devices/indi/manager'
import { clamp } from 'nebulosa/src/math/numerical/math'
import type { OperationResult } from '#/orchestration'
import type { OperationScope } from './operation'
import { resourceKey } from './resource'

// Coordinated mutations of a dew heater.
//
// Nothing here moves, so the command does not wait for the device: the driver applies the PWM level
// immediately. It acquires the heater all the same, and a heater provided by a camera or a cover is
// arbitrated under the key of that device, so raising the duty cycle competes with the exposure or the
// cover motion it would otherwise disturb.

// Owns every mutation of a dew heater.
//
// The command opens its own nested scope holding the device behind the heater, so a direct endpoint runs it
// as a whole operation tree while a composite feature, passing its own context, inherits what it owns.
export class DewHeaterCommander {
	// Keeps the manager the commands are dispatched through.
	constructor(readonly dewHeaterManager: DewHeaterManager) {}

	// Sets the heating duty cycle, in the driver's own PWM units, resolved against the limits it published.
	async dutyCycle(scope: OperationScope, heater: DewHeater, value: number): Promise<OperationResult<void>> {
		return await scope.start<void>('dewHeaterDutyCycle', [{ key: resourceKey(heater), device: heater }], () => {
			if (!heater.connected) return { ok: false, reason: 'disconnected' }
			if (!heater.hasDewHeater) return { ok: false, reason: 'unexpectedState', error: `device ${heater.name} has no dew heater` }

			this.dewHeaterManager.dutyCycle(heater, clamp(value, heater.dutyCycle.min, heater.dutyCycle.max))

			return { ok: true, value: undefined }
		}).result
	}
}
