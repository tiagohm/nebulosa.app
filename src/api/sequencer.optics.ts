import type { Wheel } from 'nebulosa/src/devices/indi/device'
import type { SequencerFilterReference } from '#/sequencer'
import { wheelSlot } from './wheel.commander'

// Resolution of the declared optical path against the devices that carry it.
//
// A definition names a filter, not a slot: a name survives a wheel rebuilt with its filters in another order,
// which a position does not. Turning one into the other needs the device, because only the wheel knows what it
// currently carries, so it happens here and never at compile time.
//
// Slots are 0-based, the convention the device model publishes and the wheel commander accepts.

// Resolves a declared filter reference to the slot the wheel can be commanded to.
//
// A name is matched against the slots the wheel publishes, and an unknown name resolves to nothing: commanding
// a slot picked as a fallback would expose through a filter the definition never asked for, and a frame taken
// through the wrong filter is worse than a frame not taken. A position is clamped to the carousel instead,
// because it already names a physical slot and the only thing that can be wrong about it is its range.
export function sequencerFilterSlot(wheel: Wheel, filter: SequencerFilterReference): number | undefined {
	if (filter.type === 'position') return wheelSlot(wheel, filter.position)

	const slot = wheel.names.indexOf(filter.name)

	return slot < 0 ? undefined : slot
}
