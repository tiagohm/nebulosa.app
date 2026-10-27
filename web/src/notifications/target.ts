import type { NotificationTarget } from 'api'
import { cameraTabKey } from '../images/cameratabs'
import { type ImagesState, selectImage, selectImageTool } from '../images/images'
import { navigate, type RouteState } from '../shell/route'

// Opens the context of a notification: the camera tab and tool of a session, or a device in Equipment Control. The
// target is resolved against what the tab shows now, so a context that is gone (a camera disconnected, another
// connection watched, a restarted server) is reported unavailable instead of being recreated. Opening only changes
// what is shown: it never switches profile or connection, commands a device, or touches a session.

// What a target is resolved against.
export interface NotificationTargetContext {
	// Images store, whose camera tabs are those of the connected cameras of the watched connection.
	readonly images: ImagesState
	// Navigation store of the tab.
	readonly route: RouteState
	// Devices of the watched connection.
	readonly devices: readonly { readonly id: string; readonly connectionId: string }[]
	// History the navigation adds its entry to.
	readonly history?: Pick<History, 'pushState'>
}

// What the tab shows that a target needs, of the stores or of snapshots of them.
export interface NotificationTargetView {
	// Open documents of Images, among them the camera tabs.
	readonly documents: readonly { readonly key: string }[]
	// Devices of the watched connection.
	readonly devices: readonly { readonly id: string; readonly connectionId: string }[]
}

// Whether a target can be opened now: its camera tab is open, or its device is one of the watched connection.
export function targetAvailable(target: NotificationTarget | undefined, view: NotificationTargetView): target is NotificationTarget {
	if (!target) return false
	if (target.kind === 'cameraTool') return view.documents.some((document) => document.key === cameraTabKey(target.connectionId, target.deviceId))
	return view.devices.some((device) => device.id === target.deviceId && device.connectionId === target.connectionId)
}

// Opens a target. Returns false, changing nothing, when it is absent or unavailable.
export function openNotificationTarget(target: NotificationTarget | undefined, context: NotificationTargetContext): boolean {
	if (!targetAvailable(target, { documents: context.images.documents, devices: context.devices })) return false

	if (target.kind === 'cameraTool') {
		const key = cameraTabKey(target.connectionId, target.deviceId)
		selectImage(context.images, key)
		selectImageTool(context.images, key, target.tool)
		navigate(context.route, { workspace: 'images' }, context.history)
	} else {
		navigate(context.route, { workspace: 'equipment', device: target.deviceId }, context.history)
	}

	return true
}
