import { DockviewReact, themeGithubDark } from 'dockview-react'
import { memo, useEffect } from 'react'
import { wsStore } from 'src/web/stores/ws.store'
import { homeStore } from '../stores/home.store'
import { Camera } from './Camera'
import { Confirmation } from './Confirmation'
import { ConnectionEdgeGroup } from './ConnectionEdgeGroup'
import { Cover } from './Cover'
import { DeviceEdgeGroup } from './DeviceEdgeGroup'
import { ImagePickerButton } from './ImagePickerButton'
import { ImageWorkspace } from './ImageWorkspace'
import { Mount } from './Mount'
import { Planetarium } from './Planetarium'
import { Sun } from './Sun'
import { Thermometer } from './Thermometer'
import { Wheel } from './Wheel'
import { CloseableTab } from './workspace/tabs/CloseableTab'
import { FixedTab } from './workspace/tabs/FixedTab'

const tabComponents = {
	'tab.fixed': FixedTab,
	'tab.closeable': CloseableTab,
} as const

const Dummy = () => <div></div>

const components = {
	'component.connections': ConnectionEdgeGroup,
	'component.devices': DeviceEdgeGroup,
	'component.device.camera': Camera,
	'component.device.mount': Mount,
	'component.device.cover': Cover,
	'component.device.wheel': Wheel,
	'component.device.thermometer': Thermometer,
	'component.images': ImageWorkspace,
	'component.atlas.sun': Sun,
	'component.atlas.moon': Dummy,
	'component.atlas.planet': Dummy,
	'component.atlas.asteroid': Dummy,
	'component.atlas.galaxy': Dummy,
	'component.atlas.satellite': Dummy,
	'component.planetarium': Planetarium,
} as const

export const Home = memo(() => {
	useEffect(homeStore.mount, [])

	// Mounts the websocket lifecycle once the home screen is active.
	useEffect(wsStore.mount, [])

	return (
		<div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] text-white">
			<header className="flex flex-row justify-center p-2">
				<ImagePickerButton />
			</header>
			<div className="min-h-0">
				<DockviewReact hideBorders scrollbars="native" defaultTabComponent={CloseableTab} theme={themeGithubDark} className="h-full w-full" tabComponents={tabComponents} components={components} onReady={homeStore.handleReady} />
				<Confirmation />
			</div>
		</div>
	)
})
