import { useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { connectionState } from '../connection/connection'
import { deviceState } from '../equipment/equipment'
import { type CameraRole, roleDefinition } from '../equipment/roles'
import { useRoleDevice } from '../equipment/useEquipment'
import { activeProfile, activeSetup, profileState, selectCameraView, setCameraReticle } from '../profile/profile'
import { CAPTURE_MODES, type CaptureMode, navigate, redirect, routeState } from '../shell/route'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/Select'
import { ImageViewer } from '../viewer/ImageViewer'
import { Reticle } from '../viewer/Reticle'
import { FIT_VIEW } from '../viewer/transform'
import { CameraTabs } from './CameraTabs'
import { cameraKey, captureRuntime, renderFrame } from './capture'
import { ModePanel } from './ModePanel'
import { CAPTURE_MODE_DEFINITIONS, captureModeUnavailable } from './modes'
import { type CameraTarget, cameraRole, cameraTabs, cameraView, captureRoute, captureViewerState, resolveCameraView, viewerKey, viewMode, viewReticle } from './views'

// Capture workspace: image acquisition with the cameras of the active profile's equipment setup. Each
// assigned camera role has a camera view, selected by a tab above the viewer and the contextual panel;
// the view has its own operational mode and viewer preferences, and every mode uses the view's camera.
// The camera view and mode shown come from the URL; the profile remembers them, and a profile switch
// reopens the view and mode that profile selected last. Switching tabs, modes, or profiles only changes
// what is shown: no device is connected, stopped, or redirected. Only the selected view is mounted. A
// URL naming a planned mode opens the camera mode instead.

// Capture workspace.
export function CaptureWorkspace() {
	const { route } = useSnapshot(routeState)
	const profiles = useSnapshot(profileState)
	const profile = activeProfile(profiles)
	const setup = activeSetup(profile)
	const capture = profile.settings.capture
	const requested = route.workspace === 'capture' ? route : undefined
	const role = resolveCameraView(setup, requested && cameraRole(requested.camera), capture.activeCamera)
	const wanted: CaptureMode = requested?.mode ?? (role ? viewMode(capture, role) : 'camera')
	const mode: CaptureMode = CAPTURE_MODE_DEFINITIONS[wanted].planned ? 'camera' : wanted
	const shownProfile = useRef(profile.id)

	// The URL follows the camera view actually shown, and the profile remembers it; after a profile
	// switch, the view and mode that profile selected last are reopened instead.
	useEffect(() => {
		if (shownProfile.current !== profile.id) {
			shownProfile.current = profile.id
			redirect(routeState, captureRoute(capture, setup))
			return
		}

		if (!role) return
		if (requested?.camera !== cameraView(role) || requested.mode !== mode) redirect(routeState, { workspace: 'capture', camera: cameraView(role), mode })
		selectCameraView(profileState, role, mode)
	}, [profile.id, capture, setup, requested?.camera, role, mode])

	if (!role) {
		return (
			<WorkspaceLayout workspace="capture" title="Capture">
				<EmptyState
					title="No cameras configured."
					description="Assign a Main Camera or Guide Camera in Equipment Setup."
					action={
						<Button variant="secondary" onClick={() => (deviceState.open = true)}>
							Equipment Setup
						</Button>
					}
				/>
			</WorkspaceLayout>
		)
	}

	const definition = CAPTURE_MODE_DEFINITIONS[mode]
	const Panel = definition.panel

	// Shows the view of another camera role in the mode it selected last.
	function selectCamera(camera: CameraRole) {
		navigate(routeState, { workspace: 'capture', camera: cameraView(camera), mode: viewMode(capture, camera) })
	}

	return (
		<WorkspaceLayout
			workspace="capture"
			title="Capture"
			tabs={<CameraTabs tabs={cameraTabs(setup)} selected={role} onSelect={selectCamera} />}
			context={<Select options={CAPTURE_MODES} value={mode} format={(m) => CAPTURE_MODE_DEFINITIONS[m].label} disabledReason={captureModeUnavailable} onChange={(m) => navigate(routeState, { workspace: 'capture', camera: cameraView(role), mode: m })} className="w-52 max-sm:w-40" />}
			panel={{
				title: definition.panelTitle,
				content: (
					<ModePanel camera={role} requires={definition.requires}>
						{Panel && <Panel camera={role} />}
					</ModePanel>
				),
			}}
		>
			<CaptureViewer key={viewerKey(role, setup)} viewer={viewerKey(role, setup)} role={role} reticle={viewReticle(capture, role, mode)} />
		</WorkspaceLayout>
	)
}

interface CaptureViewerProps {
	// Camera role of the view.
	readonly role: CameraRole
	// Key of the view's viewer, from viewerKey.
	readonly viewer: string
	// Whether the reticle is shown.
	readonly reticle: boolean
}

// Viewer of the latest frame of the view's camera with the mode's overlays. It is keyed by the camera
// role and assigned device, so nothing of a replaced device is shown; its zoom and pan are kept per
// viewer key, so they come back after switching camera views or workspaces. The frame shown is the
// latest one the server previewed for the assigned device, whichever tab started its capture; while the
// next one is exposed or rendered, the previous one stays visible. Before any frame it shows the state of
// the camera and the flow that fixes it.
function CaptureViewer({ role, viewer, reticle }: CaptureViewerProps) {
	const camera: CameraTarget = { role, ...useRoleDevice(role) }
	const views = useSnapshot(captureViewerState)
	const runtime = useSnapshot(captureRuntime)
	const key = camera.device && cameraKey(camera.device.connectionId, camera.device.id)
	const frame = key ? runtime.frames[key] : undefined
	const rendering = key ? runtime.renderings[key] : undefined

	useEffect(() => {
		if (key && frame) void renderFrame(captureRuntime, key, frame)
	}, [key, frame])

	return (
		<ImageViewer
			image={rendering}
			loading={frame !== undefined && rendering?.imageId !== frame.imageId}
			error={key ? runtime.renderErrors[key] : undefined}
			view={views[viewer] ?? FIT_VIEW}
			onViewChange={(view) => (captureViewerState[viewer] = view)}
			empty={<CameraState camera={camera} />}
			toolbar={<IconButton icon="reticle" label={reticle ? 'Hide reticle' : 'Show reticle'} pressed={reticle} onClick={() => setCameraReticle(profileState, role, !reticle)} />}
			overlays={reticle ? (size) => <Reticle {...size} /> : undefined}
		/>
	)
}

interface CameraStateProps {
	// Camera of the view.
	readonly camera: CameraTarget
}

// Empty state of the viewer, from the real state of the view's camera.
function CameraState({ camera: { role, status } }: CameraStateProps) {
	const label = roleDefinition(role).label

	switch (status) {
		case 'notSelected':
			return null
		case 'unavailable':
			return (
				<EmptyState
					title="Camera unavailable."
					description={`The connection that provides the ${label} is not open.`}
					action={
						<Button variant="secondary" onClick={() => (connectionState.open = true)}>
							Connections
						</Button>
					}
				/>
			)
		case 'connected':
			return <EmptyState title="No image captured" description="Start a capture in the Camera Capture panel." />
		case 'connecting':
		case 'disconnecting':
			return <EmptyState title={`${label} ${status === 'connecting' ? 'connecting' : 'disconnecting'}…`} />
		default:
			return (
				<EmptyState
					title={status === 'error' ? 'Camera error.' : 'Camera disconnected.'}
					description={`Connect the ${label} in Equipment Setup.`}
					action={
						<Button variant="secondary" onClick={() => (deviceState.open = true)}>
							Equipment Setup
						</Button>
					}
				/>
			)
	}
}
