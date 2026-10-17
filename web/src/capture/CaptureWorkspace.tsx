import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { connectionState } from '../connection/connection'
import { deviceState } from '../equipment/equipment'
import { useRoleDevice } from '../equipment/useEquipment'
import { CAPTURE_MODES, type CaptureMode, navigate, routeState } from '../shell/route'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/Select'
import { ImageViewer } from '../viewer/ImageViewer'
import { Reticle } from '../viewer/Reticle'
import { ModePanel } from './ModePanel'
import { CAPTURE_MODE_DEFINITIONS } from './modes'

// Capture workspace: image acquisition with the profile's main camera. One viewer shows the latest
// frame for every operational mode; the mode, selected in the header and kept in the URL, only changes
// the contextual panel and the overlays. Opening a frame in the Images workspace will snapshot it
// there, so later frames never replace an image being inspected.

// Capture workspace.
export function CaptureWorkspace() {
	const { route } = useSnapshot(routeState)
	const mode: CaptureMode = route.workspace === 'capture' ? route.mode : 'camera'
	const definition = CAPTURE_MODE_DEFINITIONS[mode]
	const Panel = definition.panel

	return (
		<WorkspaceLayout
			workspace="capture"
			title="Capture"
			context={<Select options={CAPTURE_MODES} value={mode} format={(m) => CAPTURE_MODE_DEFINITIONS[m].label} onChange={(m) => navigate(routeState, { workspace: 'capture', mode: m })} className="w-52 max-sm:w-40" />}
			panel={{
				title: definition.panelTitle,
				content: (
					<ModePanel requires={definition.requires}>
						<Panel />
					</ModePanel>
				),
			}}
		>
			<CaptureViewer key={mode} mode={mode} />
		</WorkspaceLayout>
	)
}

interface CaptureViewerProps {
	// Selected mode, whose overlays are shown by default.
	readonly mode: CaptureMode
}

// Viewer of the latest captured frame with the mode's overlays. There is no capture yet, so it shows why
// nothing can be captured and the flow that resolves it.
function CaptureViewer({ mode }: CaptureViewerProps) {
	const [reticle, setReticle] = useState(CAPTURE_MODE_DEFINITIONS[mode].overlays.includes('reticle'))

	return <ImageViewer empty={<CameraState />} toolbar={<IconButton icon="reticle" label={reticle ? 'Hide reticle' : 'Show reticle'} pressed={reticle} onClick={() => setReticle(!reticle)} />} overlays={reticle ? (size) => <Reticle {...size} /> : undefined} />
}

// Empty state of the viewer, from the real state of the main camera role.
function CameraState() {
	const { device, status } = useRoleDevice('MAIN_CAMERA')

	switch (status) {
		case 'notSelected':
			return (
				<EmptyState
					title="No main camera selected"
					description="Assign a camera to the Main Camera role in Equipment Setup."
					action={
						<Button size="sm" variant="secondary" onClick={() => (deviceState.open = true)}>
							Equipment Setup
						</Button>
					}
				/>
			)
		case 'unavailable':
			return (
				<EmptyState
					title="Main camera unavailable"
					description="The connection that provides the main camera is not open."
					action={
						<Button size="sm" variant="secondary" onClick={() => (connectionState.open = true)}>
							Connections
						</Button>
					}
				/>
			)
		case 'connected':
			return <EmptyState title="No image captured" description={`${device?.name ?? 'The main camera'} is connected. Capturing is not available yet.`} />
		case 'connecting':
		case 'disconnecting':
			return <EmptyState title={`Main camera ${status === 'connecting' ? 'connecting' : 'disconnecting'}…`} />
		default:
			return (
				<EmptyState
					title={status === 'error' ? 'Main camera error' : 'Main camera disconnected'}
					description="Connect the main camera in Equipment Setup."
					action={
						<Button size="sm" variant="secondary" onClick={() => (deviceState.open = true)}>
							Equipment Setup
						</Button>
					}
				/>
			)
	}
}
