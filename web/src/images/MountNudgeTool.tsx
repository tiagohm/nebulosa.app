import { useEffect, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import { cameraKey } from '../camera/capture'
import { MountNudgeSections } from '../camera/MountNudgePanel'
import { frameOrientation, nudgeOrientations } from '../camera/nudgepad'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { EmptyState } from '../shell/WorkspaceLayout'
import type { ImageToolPanelProps } from './tools'

// Mount Nudge tool of an Images camera tab: the nudge panel of the mount the tab's context associates with its
// camera (the MOUNT of the active equipment setup), with the state of the tab's camera. The panel is mounted per tab,
// so switching tool or camera tab unmounts it and releases any press it holds; the viewer keeps showing the tab's
// frames, and nudging never needs a new exposure. On narrow screens it is a sheet under the viewer, as every Images panel. The
// plate solution of the frame shown, or else the one its header carries, records the orientation of the camera's frames
// (nudgeOrientations), which the pad then moves by; a later unsolved frame keeps the last one.

// Mount Nudge contextual panel.
export function MountNudgeTool({ camera, document, view }: ImageToolPanelProps) {
	const { solution, header } = usePlateSolution(document?.info?.id, view?.plateSolving.selected)
	const orientations = useSnapshot(nudgeOrientations)
	const info = document?.info
	const key = camera && cameraKey(camera.camera.connectionId, camera.camera.deviceId)
	// The solution shown, or else the one the frame's own header carries.
	const wcs = solution ?? header
	const measured = useMemo(() => wcs && info && frameOrientation(wcs, info.width, info.height, info.header), [wcs, info])

	useEffect(() => {
		if (key && measured) nudgeOrientations[key] = measured
	}, [key, measured])

	if (!camera) return <EmptyState title="No camera tab" description="Select a camera tab to move the mount associated with its camera." />
	return <MountNudgeSections mount={camera.mount} camera={camera.device.device} orientation={key ? (measured ?? orientations[key]) : undefined} />
}
