import { useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { connectionState } from '../connection/connection'
import { deviceState } from '../equipment/equipment'
import { type CameraRole, roleDefinition } from '../equipment/roles'
import { useRoleDevice } from '../equipment/useEquipment'
import { activeProfile, activeSetup, autoFocusSettings, type CameraIdentity, profileCamera, profileState, selectCameraView, setAutoFocusSettings, setCameraReticle } from '../profile/profile'
import { CAPTURE_MODES, type CaptureMode, navigate, redirect, routeState } from '../shell/route'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { StarOverlay } from '../stars/StarOverlay'
import { useStarResult } from '../stars/useStarResult'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/Select'
import { ImageViewer } from '../viewer/ImageViewer'
import { Reticle } from '../viewer/Reticle'
import { FIT_VIEW } from '../viewer/transform'
import { autoFocusRuntime } from './autofocus'
import { CameraTabs } from './CameraTabs'
import { cameraKey, captureRuntime, renderFrame } from './capture'
import { FocusCurve } from './FocusCurve'
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
			<CaptureViewer
				key={viewerKey(role, setup)}
				viewer={viewerKey(role, setup)}
				role={role}
				focusing={mode === 'auto-focus'}
				reticle={viewReticle(capture, role, mode)}
				settings={profileCamera(profile, setup[role]?.id)}
				stars={mode === 'auto-focus'}
				curve={autoFocusSettings(profile.settings, profileCamera(profile, setup[role]?.id)).curve}
			/>
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
	// Camera whose Auto Focus form keeps the Focus Curve choice; absent without a saved connection.
	readonly settings?: CameraIdentity
	// Whether the star markers of the Auto Focus frame shown are drawn.
	readonly stars: boolean
	// Whether the view is in the Auto Focus mode, which shows the latest frame of its session and the Focus Curve.
	readonly focusing: boolean
	// Whether the Focus Curve is expanded.
	readonly curve: boolean
}

// Viewer of the latest frame of the view's camera with the mode's overlays. It is keyed by the camera
// role and assigned device, so nothing of a replaced device is shown; its zoom and pan are kept per
// viewer key, so they come back after switching camera views or workspaces. The frame shown is the
// latest one the server previewed for the assigned device, whichever tab started its capture; while the
// next one is exposed or rendered, the previous one stays visible. The star markers drawn are those of
// the frame shown, matched by its image id, so a late result never lands on a newer frame. Before any frame it shows the state of
// the camera and the flow that fixes it. In the Auto Focus mode the frame shown is the latest one of the camera's
// Auto Focus session, rendered apart from the captures, and the Focus Curve of the session is shown below. Inspect in
// Images opens exactly the frame on screen in the Images workspace, even when a newer frame arrives meanwhile; the
// capture goes on.
function CaptureViewer({ role, viewer, reticle, settings, stars, focusing, curve }: CaptureViewerProps) {
	const camera: CameraTarget = { role, ...useRoleDevice(role) }
	const views = useSnapshot(captureViewerState)
	const runtime = useSnapshot(captureRuntime)
	const autoFocus = useSnapshot(autoFocusRuntime)
	const key = camera.device && cameraKey(camera.device.connectionId, camera.device.id)
	const session = focusing && key ? autoFocus.sessions[key] : undefined
	// Auto Focus frames are rendered under their own key, so they never replace the rendering of a capture.
	const renderKey = key && (focusing ? `autofocus:${key}` : key)
	const frame = focusing ? session?.latestFrame : key ? runtime.frames[key] : undefined
	const rendering = renderKey ? runtime.renderings[renderKey] : undefined
	// The markers follow the frame on screen: the rendering's image, not a frame still being rendered.
	const { result } = useStarResult(stars ? rendering?.imageId : undefined)

	useEffect(() => {
		if (renderKey && frame) void renderFrame(captureRuntime, renderKey, frame)
	}, [renderKey, frame])

	const image = (
		<ImageViewer
			image={rendering}
			loading={frame !== undefined && rendering?.imageId !== frame.imageId}
			error={renderKey ? runtime.renderErrors[renderKey] : undefined}
			view={views[viewer] ?? FIT_VIEW}
			onViewChange={(view) => (captureViewerState[viewer] = view)}
			empty={<CameraState camera={camera} focusing={focusing} />}
			toolbar={<IconButton icon="reticle" label={reticle ? 'Hide reticle' : 'Show reticle'} pressed={reticle} onClick={() => setCameraReticle(profileState, role, !reticle)} />}
			overlays={
				reticle || result
					? (size, view) => (
							<>
								{reticle && <Reticle {...size} />}
								{result && <StarOverlay result={result} view={view} acceptedOnly={false} />}
							</>
						)
					: undefined
			}
		/>
	)

	if (!focusing) return image

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="relative min-h-0 flex-1">{image}</div>
			<section className="shrink-0 border-t border-line-100 bg-base-100">
				<button type="button" className="flex w-full cursor-pointer items-center justify-between border-0 bg-transparent px-3 py-1.5 text-xs font-medium text-ink-200 select-none hover:text-ink-100" onClick={() => setAutoFocusSettings(profileState, settings, { curve: !curve })}>
					<span>Focus Curve</span>
					<span className="text-ink-300">{curve ? 'Hide' : 'Show'}</span>
				</button>
				{curve && <div className="px-2 pb-2">{session ? <FocusCurve summary={session} session={autoFocus.details[session.sessionId]} /> : <p className="m-0 py-6 text-center text-xs text-ink-300">Run Auto Focus to draw the curve of this camera.</p>}</div>}
			</section>
		</div>
	)
}

interface CameraStateProps {
	// Camera of the view.
	readonly camera: CameraTarget
	// Whether the view is in the Auto Focus mode.
	readonly focusing: boolean
}

// Empty state of the viewer, from the real state of the view's camera.
function CameraState({ camera: { role, status }, focusing }: CameraStateProps) {
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
			return focusing ? <EmptyState title="No focus frame yet" description="Run Auto Focus in the panel." /> : <EmptyState title="No image captured" description="Start a capture in the Camera Capture panel." />
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
