import type { Wheel } from 'nebulosa/src/devices/indi/device'
import type { SequencerFilterFocusOffset, SequencerFilterReference } from '#/sequencer'
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

// Focuser offset declared for one slot, in device steps, or zero when the slot has none.
//
// An offset is a property of the optical path, not of a focus run: a filter that is not listed is one whose
// path is the same as the reference, which is zero rather than unknown. A reference the wheel cannot resolve
// is ignored for the same reason it is ignored everywhere else — it names a filter this wheel does not carry.
export function sequencerFocusOffset(wheel: Wheel, offsets: readonly SequencerFilterFocusOffset[], slot: number): number {
	for (const entry of offsets) {
		if (sequencerFilterSlot(wheel, entry.filter) === slot) return entry.offset
	}

	return 0
}

// Signed focuser correction to apply when the optical path moves from one slot to another, in device steps.
//
// Only the difference between the two offsets means anything: a focus position measured through one filter is
// valid for another once the path difference between them is added, and the common part of both offsets is
// already inside the measured position. Either slot being absent leaves the position where it was, since a
// path that cannot be named cannot be corrected for.
export function sequencerFocusOffsetShift(wheel: Wheel, offsets: readonly SequencerFilterFocusOffset[], from: number | undefined, to: number | undefined): number {
	if (from === undefined || to === undefined || from === to) return 0
	return sequencerFocusOffset(wheel, offsets, to) - sequencerFocusOffset(wheel, offsets, from)
}
