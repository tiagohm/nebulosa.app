import type { ServerEvent } from 'api'
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { subscribe as subscribeState } from 'valtio'
import { App } from './App'
import { autoFocusRuntime, handleAutoFocusEvent, refreshAutoFocus } from './camera/autofocus'
import { captureRuntime, handleCaptureEvent, refreshCaptures } from './camera/capture'
import { darvRuntime, handleDarvEvent, refreshDarv } from './camera/darv'
import { flatWizardRuntime, handleFlatWizardEvent, refreshFlatWizard } from './camera/flatwizard'
import { guidingRuntime, handleGuidingEvent, refreshGuiding } from './camera/guiding'
import { handleNudgeEvent, nudgeRuntime, refreshNudges } from './camera/nudge'
import { handleTppaEvent, refreshTppa, tppaRuntime } from './camera/tppa'
import { connectionState, handleConnectionEvent, loadConnections, persistConnections, refreshServers } from './connection/connection'
import { controlRuntime, handleControlEvent, refreshStates } from './equipment-control/control'
import { domeMotionRuntime, handleDomeMotionEvent, refreshDomeMotions } from './equipment-control/domeMotion'
import { focuserBacklashRuntime, handleFocuserBacklashEvent, refreshFocuserBacklash } from './equipment-control/focuserBacklash'
import { handleIndiDirectoryEvent, indiDirectory, refreshIndiDirectory } from './equipment-control/indi/directory'
import { deviceState, handleDeviceEvent, refreshDevices } from './equipment/equipment'
import { onOpen, subscribe } from './events'
import { handleCapturedFrame, reconcileCameraTabs, reconcileCapturedFrames, releaseLeasesOnHide } from './images/cameratabs'
import { captureFramesState, handleCaptureFramesEvent, refreshCaptureFrames } from './images/captureframes'
import { confirmUnsavedOnUnload, imagesState } from './images/images'
import { handleOperationEvent, operationsState, refreshOperations } from './operations'
import { handlePlateSolvingEvent, plateSolvingState, refreshPlateSolving } from './platesolving/platesolving'
import { loadProfiles, persistProfiles, profileState } from './profile/profile'
import { externalToolsState, handleExternalToolEvent, refreshExternalTools } from './settings/externaltools'
import { routeState, watchHistory } from './shell/route'
import { handleStarsEvent, refreshStars, starsState } from './stars/stars'
import { browserStores } from './storage'
import { handleMountRemoteControlEvent, mountRemoteControlState, refreshMountRemoteControl } from './tools/mountremotecontrol/listeners'

// Entry point of the browser bundle: restores the persisted stores and the URL route before the first
// render, starts persisting them, and keeps the server state current through the event socket. Under HMR the module
// re-runs on every update: the React root is reused and the previous run's subscriptions are released.

const stores = browserStores()

loadConnections(connectionState, stores.local)
loadProfiles(profileState, stores)

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
// tabs of Images show and shows their selections again.
const SERVER_STORES: readonly ServerStore[] = [
	{ handle: (event) => handleConnectionEvent(connectionState, event), refresh: () => refreshServers(connectionState) },
	{ handle: (event) => handleDeviceEvent(deviceState, event), refresh: () => refreshDevices(deviceState) },
	{ handle: (event) => handleIndiDirectoryEvent(indiDirectory, event), refresh: () => refreshIndiDirectory(indiDirectory) },
	{ handle: (event) => handleControlEvent(controlRuntime, event), refresh: () => refreshStates(controlRuntime) },
	{ handle: (event) => handleDomeMotionEvent(domeMotionRuntime, event), refresh: () => refreshDomeMotions(domeMotionRuntime) },
	{ handle: (event) => handleFocuserBacklashEvent(focuserBacklashRuntime, event), refresh: () => refreshFocuserBacklash(focuserBacklashRuntime) },
	{ handle: (event) => handleOperationEvent(operationsState, event), refresh: () => refreshOperations(operationsState) },
	{ handle: (event) => handleCaptureEvent(captureRuntime, event), refresh: () => refreshCaptures(captureRuntime) },
	{ handle: (event) => handleNudgeEvent(nudgeRuntime, event), refresh: () => refreshNudges(nudgeRuntime) },
	{ handle: (event) => handleMountRemoteControlEvent(mountRemoteControlState, event), refresh: () => refreshMountRemoteControl(mountRemoteControlState) },
	{ handle: (event) => handleAutoFocusEvent(autoFocusRuntime, event), refresh: () => refreshAutoFocus(autoFocusRuntime) },
	{ handle: (event) => handleTppaEvent(tppaRuntime, event), refresh: () => refreshTppa(tppaRuntime) },
	{ handle: (event) => handleDarvEvent(darvRuntime, event), refresh: () => refreshDarv(darvRuntime) },
	{ handle: (event) => handleFlatWizardEvent(flatWizardRuntime, event), refresh: () => refreshFlatWizard(flatWizardRuntime) },
	{ handle: (event) => handleGuidingEvent(guidingRuntime, event), refresh: () => refreshGuiding(guidingRuntime) },
	{ handle: (event) => handleExternalToolEvent(externalToolsState, event), refresh: () => refreshExternalTools(externalToolsState) },
	{ handle: (event) => handleStarsEvent(starsState, event), refresh: () => refreshStars(starsState) },
	{ handle: (event) => handlePlateSolvingEvent(plateSolvingState, event), refresh: () => refreshPlateSolving(plateSolvingState) },
	{ handle: (event) => handleCaptureFramesEvent(captureFramesState, event), refresh: () => refreshCaptureFrames(captureFramesState).then(() => reconcileCapturedFrames(imagesState, captureFramesState)) },
	{ handle: (event) => handleCapturedFrame(imagesState, event) },
]

// Functions that stop this run's persistence and event subscriptions.
const stops = [
	subscribeState(deviceState, syncCameraTabs),
	persistConnections(connectionState, stores.local),
	persistProfiles(profileState, stores),
	watchHistory(routeState),
	confirmUnsavedOnUnload(imagesState),
	releaseLeasesOnHide(imagesState),
	subscribe((event) => {
		for (const store of SERVER_STORES) store.handle(event)
	}),
	onOpen(() => {
		for (const store of SERVER_STORES) void store.refresh?.()
	}),
]

import.meta.hot.accept()
import.meta.hot.dispose(() => {
	for (const stop of stops) stop()
})

// Renders the app into the page's root element, reusing the root created by a previous HMR run.
function start() {
	const root: Root = (import.meta.hot.data.root ??= createRoot(document.getElementById('root')!))

	root.render(
		<StrictMode>
			<App />
		</StrictMode>,
	)
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', start)
} else {
	start()
}
