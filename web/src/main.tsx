import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { subscribe as subscribeState } from 'valtio'
import { App } from './App'
import { autoFocusRuntime, handleAutoFocusEvent, refreshAutoFocus } from './capture/autofocus'
import { captureRuntime, handleCaptureEvent, refreshCameraCapabilities, refreshCaptures } from './capture/capture'
import { handleNudgeEvent, nudgeRuntime, refreshNudgeMount, refreshNudges } from './capture/nudge'
import { connectionState, handleConnectionEvent, loadConnections, persistConnections, refreshServers } from './connection/connection'
import { controlRuntime, handleControlEvent, refreshStates } from './equipment-control/control'
import { domeMotionRuntime, handleDomeMotionEvent, refreshDomeMotions } from './equipment-control/domeMotion'
import { focuserBacklashRuntime, handleFocuserBacklashEvent, refreshFocuserBacklash } from './equipment-control/focuserBacklash'
import { deviceState, handleDeviceEvent, refreshDevices } from './equipment/equipment'
import { onOpen, subscribe } from './events'
import { captureFramesState, handleCaptureFramesEvent, refreshCaptureFrames } from './images/captureframes'
import { handleCapturedFrame, imagesState, reconcileCameraTabs, reconcileCapturedFrames } from './images/images'
import { handleOperationEvent, operationsState, refreshOperations } from './operations'
import { handlePlateSolvingEvent, plateSolvingState, refreshPlateSolving } from './platesolving/platesolving'
import { loadProfiles, persistProfiles, profileState } from './profile/profile'
import { externalToolsState, handleExternalToolEvent, refreshExternalTools } from './settings/externaltools'
import { routeState, watchHistory } from './shell/route'
import { handleMountEvent, mountRuntime, refreshMount } from './sky/mount'
import { handleSensorEvent, refreshSensors, sensorRuntime } from './sky/sensors'
import { handleStarsEvent, refreshStars, starsState } from './stars/stars'
import { browserStores } from './storage'

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

// Functions that stop this run's persistence and event subscriptions.
const stops = [
	subscribeState(deviceState, syncCameraTabs),
	persistConnections(connectionState, stores.local),
	persistProfiles(profileState, stores),
	watchHistory(routeState),
	subscribe((event) => {
		handleConnectionEvent(connectionState, event)
		handleDeviceEvent(deviceState, event)
		handleControlEvent(controlRuntime, event)
		handleDomeMotionEvent(domeMotionRuntime, event)
		handleFocuserBacklashEvent(focuserBacklashRuntime, event)
		handleMountEvent(mountRuntime, event)
		handleOperationEvent(operationsState, event)
		handleSensorEvent(sensorRuntime, event)
		handleCaptureEvent(captureRuntime, event)
		handleNudgeEvent(nudgeRuntime, event)
		handleAutoFocusEvent(autoFocusRuntime, event)
		handleExternalToolEvent(externalToolsState, event)
		handleStarsEvent(starsState, event)
		handlePlateSolvingEvent(plateSolvingState, event)
		handleCaptureFramesEvent(captureFramesState, event)
		handleCapturedFrame(imagesState, event)
	}),
	// Every (re)open resynchronizes the open connections, the watched devices and their control states, the followed mount, the
	// running operations, the camera sensors, the captures and camera capabilities, and the nudged mount
	// and its nudge sessions, the Auto Focus sessions, the dome rotation sessions, the focuser backlash compensations, the external tool settings, the star detection and plate solving jobs, and the captured frames, which may have changed while the socket was closed; then the leases of the frames the camera tabs of Images show are reconciled and their selections shown again.
	onOpen(() => {
		void refreshExternalTools(externalToolsState)
		void refreshServers(connectionState)
		void refreshDevices(deviceState)
		void refreshStates(controlRuntime)
		void refreshDomeMotions(domeMotionRuntime)
		void refreshFocuserBacklash(focuserBacklashRuntime)
		void refreshMount(mountRuntime)
		void refreshOperations(operationsState)
		refreshSensors(sensorRuntime)
		void refreshCaptures(captureRuntime)
		refreshCameraCapabilities(captureRuntime)
		void refreshNudgeMount(nudgeRuntime)
		void refreshNudges(nudgeRuntime)
		void refreshAutoFocus(autoFocusRuntime)
		void refreshStars(starsState)
		void refreshPlateSolving(plateSolvingState)
		void refreshCaptureFrames(captureFramesState).then(() => reconcileCapturedFrames(imagesState, captureFramesState))
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
