import { DockviewReact, themeGithubDark } from 'dockview-react'
import { memo, useEffect } from 'react'
import { wsStore } from 'src/web/stores/ws.store'
import { homeStore } from '../stores/home.store'
import { Asteroid } from './Asteroid'
import { Calculator } from './Calculator'
import { Camera } from './Camera'
import { Confirmation } from './Confirmation'
import { ConnectionEdgeGroup } from './ConnectionEdgeGroup'
import { Cover } from './Cover'
import { DeviceEdgeGroup } from './DeviceEdgeGroup'
import { Galaxy } from './Galaxy'
import { ImagePickerButton } from './ImagePickerButton'
import { ImageWorkspace } from './ImageWorkspace'
import { Moon } from './Moon'
import { Mount } from './Mount'
import { Planet } from './Planet'
import { Planetarium } from './Planetarium'
import { Satellite } from './Satellite'
import { Sun } from './Sun'
import { Thermometer } from './Thermometer'
import { Wheel } from './Wheel'
import { CloseableTab } from './workspace/tabs/CloseableTab'
import { FixedTab } from './workspace/tabs/FixedTab'

const tabComponents = {
	'tab.fixed': FixedTab,
	'tab.closeable': CloseableTab,
} as const

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
	'component.atlas.moon': Moon,
	'component.atlas.planet': Planet,
	'component.atlas.asteroid': Asteroid,
	'component.atlas.galaxy': Galaxy,
	'component.atlas.satellite': Satellite,
	'component.planetarium': Planetarium,
	'component.calculator': Calculator,
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
