import { DockviewReact, themeGithubDark } from 'dockview-react'
import { memo } from 'react'
import { useStore } from '../../hooks/store.hook'
import { workspaceStore } from '../../stores/workspace.store'
import { Camera } from '../Camera'
import { Cover } from '../Cover'
import { ImageWorkspace } from '../ImageWorkspace'
import { Mount } from '../Mount'
import { Thermometer } from '../Thermometer'
import { Wheel } from '../Wheel'
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
	'component.device.wheel': Wheel,
	'component.device.thermometer': Thermometer,
	'component.images': ImageWorkspace,
} as const

export const Workspace = memo(() => {
	useStore(workspaceStore, [])

	return <DockviewReact hideBorders theme={themeGithubDark} className="h-full w-full" tabComponents={tabComponents} components={components} onReady={workspaceStore.handleReady} />
})
