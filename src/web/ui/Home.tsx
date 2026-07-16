import { homeStore } from '@stores/home.store'
import { Asteroid } from '@ui/Asteroid'
import { Calculator } from '@ui/Calculator'
import { Camera } from '@ui/Camera'
import { Confirmation } from '@ui/Confirmation'
import { ConnectionEdgeGroup } from '@ui/ConnectionEdgeGroup'
import { Cover } from '@ui/Cover'
import { DeviceEdgeGroup } from '@ui/DeviceEdgeGroup'
import { Galaxy } from '@ui/Galaxy'
import { ImagePickerButton } from '@ui/ImagePickerButton'
import { ImageWorkspace } from '@ui/ImageWorkspace'
import { Moon } from '@ui/Moon'
import { Mount } from '@ui/Mount'
import { Planet } from '@ui/Planet'
import { Planetarium } from '@ui/Planetarium'
import { Satellite } from '@ui/Satellite'
import { Sun } from '@ui/Sun'
import { Thermometer } from '@ui/Thermometer'
import { Wheel } from '@ui/Wheel'
import { CloseableTab } from '@ui/workspace/tabs/CloseableTab'
import { FixedTab } from '@ui/workspace/tabs/FixedTab'
import { DockviewReact, themeGithubDark } from 'dockview-react'
import { memo, useEffect } from 'react'
import { wsStore } from 'src/web/stores/ws.store'

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
