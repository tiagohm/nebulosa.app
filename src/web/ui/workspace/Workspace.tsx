import { DockviewReact, themeGithubDark } from 'dockview-react'
import { memo } from 'react'
import { useStore } from '../../hooks/store.hook'
import { workspaceStore } from '../../stores/workspace.store'
import { Camera } from '../devices/camera/Camera'
import { Cover } from '../devices/cover/Cover'
import { Mount } from '../devices/mount/Mount'
import { ImageWorkspace } from '../images/ImageWorkspace'
import { Connections } from './left/Connections'
import { Devices } from './left/Devices'
import { CloseableTab } from './tabs/CloseableTab'
import { FixedTab } from './tabs/FixedTab'

const tabComponents = {
	'tab.fixed': FixedTab,
	'tab.closeable': CloseableTab,
} as const

const components = {
	'component.connections': Connections,
	'component.devices': Devices,
	'component.device.camera': Camera,
	'component.device.mount': Mount,
	'component.device.cover': Cover,
	'component.images': ImageWorkspace,
} as const

export const Workspace = memo(() => {
	useStore(workspaceStore, [])

	return <DockviewReact hideBorders theme={themeGithubDark} className="h-full w-full" tabComponents={tabComponents} components={components} onReady={workspaceStore.handleReady} />
})
