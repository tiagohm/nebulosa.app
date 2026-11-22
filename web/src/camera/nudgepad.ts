import type { MountNudgeDirection, MountState } from 'api'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { proxy } from 'valtio'
import { skyDirections } from '../platesolving/wcs'

// Layout of the Mount Nudge pad and how its cells map to the mount's directions. The pad has eight cells around STOP,
// named by where they sit on screen. Without an orientation each cell keeps the hand-controller convention of the mount
// axes (north up, east right). With the orientation of a solved frame of the camera, each cell moves the field toward
// that edge of the frame as the viewer draws it (which never rotates or mirrors an image), so the stars drift the
// other way: the cell takes the mount direction whose sky direction lies closest to it on screen, the compass turned
// and, for a mirrored optical train, reflected onto the pad, so the eight cells always hold the eight directions. An
// orientation records the pier side of the frame it came from, and is stale once the mount reports the other one,
// since a meridian flip turns the field. The orientations of the tab's cameras live in nudgeOrientations.

// Cell of the pad, by its place on screen.
export type PadCell = 'up-left' | 'up' | 'up-right' | 'left' | 'right' | 'down-left' | 'down' | 'down-right'

// Cells of the pad row by row, with STOP in the middle.
export const PAD_GRID: readonly (PadCell | 'STOP')[] = ['up-left', 'up', 'up-right', 'left', 'STOP', 'right', 'down-left', 'down', 'down-right']

// Direction of each cell on screen, in eighths of a turn clockwise from the right (screen +Y points down), [0, 8).
const CELL_OCTANTS: Readonly<Record<PadCell, number>> = { right: 0, 'down-right': 1, down: 2, 'down-left': 3, left: 4, 'up-left': 5, up: 6, 'up-right': 7 }

// Words of each cell, for its tooltip.
export const PAD_CELL_LABELS: Readonly<Record<PadCell, string>> = { 'up-left': 'up and left', up: 'up', 'up-right': 'up and right', left: 'left', right: 'right', 'down-left': 'down and left', down: 'down', 'down-right': 'down and right' }

// Mount directions in compass order, from north through east, an eighth of a turn apart on the sky.
const COMPASS: readonly MountNudgeDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

// Cell each arrow key presses.
export const PAD_KEYS: Readonly<Record<string, PadCell>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

// Mount direction of each cell of the pad.
export type PadMapping = Readonly<Record<PadCell, MountNudgeDirection>>

// Mapping by the mount axes: north up and east right, the hand-controller convention.
export const AXIS_MAPPING: PadMapping = { 'up-left': 'NW', up: 'N', 'up-right': 'NE', left: 'W', right: 'E', 'down-left': 'SW', down: 'S', 'down-right': 'SE' }

// Orientation of the sky on the frames of a camera, from a plate solution of one of them.
export interface NudgeOrientation {
	// Direction of north on screen, snapped to an eighth of a turn clockwise from the right, [0, 8).
	readonly north: number
	// 1 when east lies a quarter turn clockwise from north on screen, -1 when it lies counterclockwise, the sky as seen
	// without a mirror.
	readonly parity: 1 | -1
	// Angle between true north on screen and its snapped direction, in radians, [0, π/8].
	readonly skew: number
	// Pier side the frame was taken on, from its PIERSIDE header; absent when the header does not say.
	readonly pierSide?: 'EAST' | 'WEST'
}

// Orientations of the cameras of the tab, by camera key (cameraKey), each from the latest solved frame of the camera
// shown on its tab; kept until a frame solved again replaces it.
export const nudgeOrientations = proxy<Record<string, NudgeOrientation>>({})

// Returns n modulo 8, in [0, 8).
function octant(n: number) {
	return ((n % 8) + 8) % 8
}

// Returns the orientation of a frame from its plate solution, measured at its centre: solution is the WCS, width and
// height the size of the frame in pixels, and header the frame's header, whose PIERSIDE is recorded. Undefined when the
// sky directions cannot be projected there.
export function frameOrientation(solution: FitsHeader, width: number, height: number, header?: FitsHeader): NudgeOrientation | undefined {
	const { north, east } = skyDirections(solution, { x: width / 2, y: height / 2 })
	if (!north || !east) return undefined

	const angle = Math.atan2(north.y, north.x)
	const snapped = Math.round(angle / (Math.PI / 4))
	const parity = north.x * east.y - north.y * east.x < 0 ? -1 : 1
	const pierSide = header?.PIERSIDE
	return { north: octant(snapped), parity, skew: Math.abs(angle - (snapped * Math.PI) / 4), ...((pierSide === 'EAST' || pierSide === 'WEST') && { pierSide }) }
}

// Returns the mount direction of each cell for an orientation: the compass turned so north takes the cell nearest to
// it, and reflected when the frame is mirrored.
export function padMapping(orientation: NudgeOrientation): PadMapping {
	const at = (cell: PadCell) => COMPASS[octant(orientation.parity * (CELL_OCTANTS[cell] - orientation.north))]
	return { 'up-left': at('up-left'), up: at('up'), 'up-right': at('up-right'), left: at('left'), right: at('right'), 'down-left': at('down-left'), down: at('down'), 'down-right': at('down-right') }
}

// Returns whether an orientation no longer holds for a mount: both say their pier side and they differ.
export function orientationStale(orientation: NudgeOrientation, mount: Pick<MountState, 'hasPierSide' | 'pierSide'> | undefined) {
	return !!orientation.pierSide && !!mount?.hasPierSide && mount.pierSide !== 'NEITHER' && mount.pierSide !== orientation.pierSide
}

// Rotation of the up-pointing arrow icon to the direction of each cell.
export const PAD_ARROW_ROTATIONS: Readonly<Record<PadCell, string>> = { up: '', 'up-right': 'rotate-45', right: 'rotate-90', 'down-right': 'rotate-135', down: 'rotate-180', 'down-left': '-rotate-135', left: '-rotate-90', 'up-left': '-rotate-45' }
