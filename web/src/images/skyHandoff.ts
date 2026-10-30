import { navigate, routeState } from '../shell/route'
import { showCoordinateInSky, type SkyPoint, skyImageState } from '../sky/footprint'

// Opening a point of a solved image in the Sky workspace: the point is marked on the map, which is panned to it, and
// the workspace is shown. Only what is shown changes: the Sky selection, its clock, and the mount are left alone.

// Marks a sky position of an image (J2000 in the frame of its solution, radians) with a label on the Sky map and shows
// the Sky workspace panned to it.
export function openInSky(position: SkyPoint, label: string) {
	showCoordinateInSky(skyImageState, position, label)
	navigate(routeState, { workspace: 'sky' })
}
