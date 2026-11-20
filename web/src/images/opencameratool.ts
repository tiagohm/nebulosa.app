import { navigate, routeState } from '../shell/route'
import { cameraTabKey } from './cameratabs'
import { imagesState, selectImage, selectImageTool } from './images'
import type { ImageToolId } from './tools'

// Opening of a camera tool from anywhere in the app: the camera tab of the Images workspace, the tool in its panel, and
// the workspace itself. It commands nothing; the tool only shows its settings and sessions.

// Shows the camera tab of a camera with one of its tools in the Images workspace, switching to that workspace when
// another one is shown. A camera without a tab, being disconnected, leaves the tab and the tool unchanged.
export function openCameraTool(connectionId: string, deviceId: string, tool: ImageToolId) {
	const key = cameraTabKey(connectionId, deviceId)
	selectImage(imagesState, key)
	selectImageTool(imagesState, key, tool)
	navigate(routeState, { workspace: 'images' })
}
