import type { ServerEvent } from 'api'
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { subscribe as subscribeState } from 'valtio'
import { annotationsState, handleAnnotationsEvent, refreshAnnotations } from './annotations/annotations'
import { App } from './App'
import { calibrationLibraryRuntime, handleCalibrationLibraryEvent, refreshCalibrationLibrary } from './calibrationlibrary/calibrationlibrary'
import { autoFocusRuntime, handleAutoFocusEvent, refreshAutoFocus } from './camera/autofocus'
import { captureRuntime, handleCaptureEvent, refreshCaptures } from './camera/capture'
import { darkLibraryWizardRuntime, handleDarkLibraryWizardEvent, refreshDarkLibraryWizard } from './camera/darklibrarywizard'
import { darvRuntime, handleDarvEvent, refreshDarv } from './camera/darv'
import { flatWizardRuntime, handleFlatWizardEvent, refreshFlatWizard } from './camera/flatwizard'
import { guidingRuntime, handleGuidingEvent, refreshGuiding } from './camera/guiding'
import { handleNudgeEvent, nudgeRuntime, refreshNudges } from './camera/nudge'
import { handleTargetCenteringEvent, refreshTargetCentering, targetCenteringRuntime } from './camera/targetcentering'
import { handleTppaEvent, refreshTppa, tppaRuntime } from './camera/tppa'
import { connectionState, handleConnectionEvent, refreshServers } from './connection/connection'
import { controlRuntime, handleControlEvent, refreshStates } from './equipment-control/control'
import { domeMotionRuntime, handleDomeMotionEvent, refreshDomeMotions } from './equipment-control/domeMotion'
import { focuserBacklashRuntime, handleFocuserBacklashEvent, refreshFocuserBacklash } from './equipment-control/focuserBacklash'
import { handleIndiDirectoryEvent, indiDirectory, refreshIndiDirectory } from './equipment-control/indi/directory'
import { deviceState, handleDeviceEvent, refreshDevices } from './equipment/equipment'
import { onClose, onOpen, subscribe } from './events'
import { handleCapturedFrame, reconcileCameraTabs, reconcileCapturedFrames, releaseLeasesOnHide } from './images/cameratabs'
import { captureFramesState, handleCaptureFramesEvent, refreshCaptureFrames } from './images/captureframes'
import { handleImageProcessingEvent, imageProcessingState, refreshImageProcessing } from './images/imageprocessing'
import { confirmUnsavedOnUnload, imagesState } from './images/images'
import { handleMountPointingEvent, mountPointingRuntime, refreshMountPointing } from './mountpointing/mountpointing'
import { handleNotificationEvent, notificationsState, refreshNotifications, setServerLink } from './notifications/notifications'
import { handleOperationEvent, operationsState, refreshOperations } from './operations'
import { handlePlateSolvingEvent, plateSolvingState, refreshPlateSolving } from './platesolving/platesolving'
import { profileState, pruneNotificationPreferences } from './profile/profile'
import { WorkspaceSync } from './profile/sync'
import { cameraToolsEntry, centeringTargetsEntry, keepViewEntries, sectionsEntry, ViewPersistence } from './profile/view'
import { WorkspaceGate } from './profile/WorkspaceGate'
import { externalToolsState, handleExternalToolEvent, refreshExternalTools } from './settings/externaltools'
import { collapsibleSections } from './shell/collapsible'
import { routeState, watchHistory } from './shell/route'
import { handleStarsEvent, refreshStars, starsState } from './stars/stars'
import { handleStreaksEvent, refreshStreaks, streaksState } from './streaks/streaks'
import { handleImageStackingEvent, imageStackingRuntime, refreshImageStacking } from './tools/imagestacking/projects'
import { handleMountRemoteControlEvent, mountRemoteControlState, refreshMountRemoteControl } from './tools/mountremotecontrol/listeners'

// Entry point of the browser bundle: restores the URL route, reads the workspace (saved connections and profiles) from
// the server, which the shell waits for, writes back what the tab changes in it, keeps the view state of the tab in
// browser storage (profile/view.ts), and keeps the server state current through the event socket. Under HMR the module
// re-runs on every update: the React root is reused and the previous run's subscriptions are released.

// Synchronization of the saved connections and the profiles of the tab with the server.
const workspace = new WorkspaceSync(connectionState, profileState)

// Gives the Images workspace a camera tab for each connected camera of the watched connection, and removes the tabs of
// the others.
function syncCameraTabs() {
	const cameras = deviceState.devices.filter((device) => device.type === 'camera' && device.connected).map(({ connectionId, id, name }) => ({ connectionId, id, name }))
	reconcileCameraTabs(imagesState, cameras, captureFramesState)
}

syncCameraTabs()

// How a store mirrors server state: handle applies every server event, in the order of SERVER_STORES, and refresh
// fetches its snapshot again on every socket (re)open, since it may have changed while the socket was closed.
interface ServerStore {
	// Applies a server event; the store ignores the events of others.
	readonly handle: (event: ServerEvent) => void
	// Fetches the store's snapshot again; absent for a store fed by events only.
	readonly refresh?: () => Promise<unknown>
}

// Stores mirroring server state. A refresh of the captured frames then reconciles the leases of the frames the camera
// tabs of Images show and shows their selections again; a refresh of the notifications then drops from the profiles the
// read and dismissed states of notifications the server no longer retains.
const SERVER_STORES: readonly ServerStore[] = [
	{ handle: (event) => workspace.handle(event), refresh: () => workspace.refresh() },
	{ handle: (event) => handleConnectionEvent(connectionState, event), refresh: () => refreshServers(connectionState) },
	{ handle: (event) => handleDeviceEvent(deviceState, event), refresh: () => refreshDevices(deviceState) },
	{ handle: (event) => handleIndiDirectoryEvent(indiDirectory, event), refresh: () => refreshIndiDirectory(indiDirectory) },
	{ handle: (event) => handleControlEvent(controlRuntime, event), refresh: () => refreshStates(controlRuntime) },
	{ handle: (event) => handleDomeMotionEvent(domeMotionRuntime, event), refresh: () => refreshDomeMotions(domeMotionRuntime) },
	{ handle: (event) => handleFocuserBacklashEvent(focuserBacklashRuntime, event), refresh: () => refreshFocuserBacklash(focuserBacklashRuntime) },
	{ handle: (event) => handleOperationEvent(operationsState, event), refresh: () => refreshOperations(operationsState) },
	{
		handle: (event) => handleNotificationEvent(notificationsState, event),
		refresh: () => refreshNotifications(notificationsState).then((ids) => ids && pruneNotificationPreferences(profileState, ids)),
	},
	{ handle: (event) => handleCaptureEvent(captureRuntime, event), refresh: () => refreshCaptures(captureRuntime) },
	{ handle: (event) => handleNudgeEvent(nudgeRuntime, event), refresh: () => refreshNudges(nudgeRuntime) },
	{ handle: (event) => handleMountRemoteControlEvent(mountRemoteControlState, event), refresh: () => refreshMountRemoteControl(mountRemoteControlState) },
	{ handle: (event) => handleAutoFocusEvent(autoFocusRuntime, event), refresh: () => refreshAutoFocus(autoFocusRuntime) },
	{ handle: (event) => handleTppaEvent(tppaRuntime, event), refresh: () => refreshTppa(tppaRuntime) },
	{ handle: (event) => handleMountPointingEvent(mountPointingRuntime, event), refresh: () => refreshMountPointing(mountPointingRuntime) },
	{ handle: (event) => handleTargetCenteringEvent(targetCenteringRuntime, event), refresh: () => refreshTargetCentering(targetCenteringRuntime) },
	{ handle: (event) => handleDarvEvent(darvRuntime, event), refresh: () => refreshDarv(darvRuntime) },
	{ handle: (event) => handleFlatWizardEvent(flatWizardRuntime, event), refresh: () => refreshFlatWizard(flatWizardRuntime) },
	{ handle: (event) => handleDarkLibraryWizardEvent(darkLibraryWizardRuntime, event), refresh: () => refreshDarkLibraryWizard(darkLibraryWizardRuntime) },
	{ handle: (event) => handleCalibrationLibraryEvent(calibrationLibraryRuntime, event), refresh: () => refreshCalibrationLibrary(calibrationLibraryRuntime) },
	{ handle: (event) => handleImageStackingEvent(imageStackingRuntime, event), refresh: () => refreshImageStacking(imageStackingRuntime) },
	{ handle: (event) => handleGuidingEvent(guidingRuntime, event), refresh: () => refreshGuiding(guidingRuntime) },
	{ handle: (event) => handleExternalToolEvent(externalToolsState, event), refresh: () => refreshExternalTools(externalToolsState) },
	{ handle: (event) => handleStarsEvent(starsState, event), refresh: () => refreshStars(starsState) },
	{ handle: (event) => handleStreaksEvent(streaksState, event), refresh: () => refreshStreaks(streaksState) },
	{ handle: (event) => handlePlateSolvingEvent(plateSolvingState, event), refresh: () => refreshPlateSolving(plateSolvingState) },
	{ handle: (event) => handleAnnotationsEvent(annotationsState, event), refresh: () => refreshAnnotations(annotationsState) },
	{ handle: (event) => handleImageProcessingEvent(imageProcessingState, imagesState, event), refresh: () => refreshImageProcessing(imageProcessingState, imagesState) },
	{ handle: (event) => handleCaptureFramesEvent(captureFramesState, event), refresh: () => refreshCaptureFrames(captureFramesState).then(() => reconcileCapturedFrames(imagesState, captureFramesState)) },
	{ handle: (event) => handleCapturedFrame(imagesState, event) },
]

// Functions that stop this run's persistence and event subscriptions.
const stops = [
	subscribeState(deviceState, syncCameraTabs),
	workspace.start(),
	new ViewPersistence(profileState).start(),
	keepViewEntries([sectionsEntry(collapsibleSections), cameraToolsEntry(imagesState), centeringTargetsEntry(targetCenteringRuntime)]),
	watchHistory(routeState),
	confirmUnsavedOnUnload(imagesState),
	releaseLeasesOnHide(imagesState),
	subscribe((event) => {
		for (const store of SERVER_STORES) store.handle(event)
	}),
	onOpen(() => {
		setServerLink(notificationsState, 'online')
		for (const store of SERVER_STORES) void store.refresh?.()
	}),
	onClose(() => setServerLink(notificationsState, 'offline')),
]

// The workspace is read at once, before the socket opens, so the shell shows as soon as the server answers.
void workspace.refresh()

import.meta.hot.accept()
import.meta.hot.dispose(() => {
	for (const stop of stops) stop()
})

// Renders the app into the page's root element, reusing the root created by a previous HMR run.
function start() {
	const root: Root = (import.meta.hot.data.root ??= createRoot(document.getElementById('root')!))

	root.render(
		<StrictMode>
			<WorkspaceGate>
				<App />
			</WorkspaceGate>
		</StrictMode>,
	)
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', start)
} else {
	start()
}
