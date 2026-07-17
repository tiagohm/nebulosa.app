import { homeStore } from '@stores/home.store'
import { About } from '@ui/About'
import { Asteroid } from '@ui/Asteroid'
import { AutoFocus } from '@ui/AutoFocus'
import { Calculator } from '@ui/Calculator'
import { Camera } from '@ui/Camera'
import { CloseableTab } from '@ui/CloseableTab'
import { Confirmation } from '@ui/Confirmation'
import { Connections } from '@ui/Connections'
import { Cover } from '@ui/Cover'
import { Darv } from '@ui/Darv'
import { Devices } from '@ui/Devices'
import { FixedTab } from '@ui/FixedTab'
import { FlatWizard } from '@ui/FlatWizard'
import { Galaxy } from '@ui/Galaxy'
import { ImagePickerButton } from '@ui/ImagePickerButton'
import { ImageWorkspace } from '@ui/ImageWorkspace'
import { Moon } from '@ui/Moon'
import { Mount } from '@ui/Mount'
import { Planet } from '@ui/Planet'
import { Planetarium } from '@ui/Planetarium'
import { Satellite } from '@ui/Satellite'
import { Settings } from '@ui/Settings'
import { Sun } from '@ui/Sun'
import { Thermometer } from '@ui/Thermometer'
import { Tppa } from '@ui/Tppa'
import { Wheel } from '@ui/Wheel'
import { DockviewReact, themeGithubDark } from 'dockview-react'
import { memo, useEffect } from 'react'
import { wsStore } from 'src/web/stores/ws.store'

const tabComponents = {
	fixed: FixedTab,
	closeable: CloseableTab,
} as const

const components = {
	connections: Connections,
	devices: Devices,
	about: About,
	camera: Camera,
	mount: Mount,
	cover: Cover,
	wheel: Wheel,
	thermometer: Thermometer,
	image: ImageWorkspace,
	sun: Sun,
	moon: Moon,
	planet: Planet,
	asteroid: Asteroid,
	galaxy: Galaxy,
	satellite: Satellite,
	planetarium: Planetarium,
	calculator: Calculator,
	darv: Darv,
	tppa: Tppa,
	autofocus: AutoFocus,
	flatwizard: FlatWizard,
	settings: Settings,
} as const

export const Home = memo(() => {
	// Mounts the websocket and home lifecycle once the home screen is active.
	useEffect(wsStore.mount, [])
	useEffect(homeStore.mount, [])

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
