import { homeStore, type HomePanelType } from '@stores/home.store'
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
import { DockviewReact, themeGithubDark, type IDockviewPanelProps } from 'dockview-react'
import { memo, useEffect, type MemoExoticComponent } from 'react'
import { wsStore } from 'src/web/stores/ws.store'
import { Alpaca } from './Alpaca'

const tabComponents = {
	fixed: FixedTab,
	closeable: CloseableTab,
} as const

const Dummy = memo((_props: IDockviewPanelProps) => <div></div>)

const components = {
	about: About,
	alpaca: Alpaca,
	asteroid: Asteroid,
	autoFocus: AutoFocus,
	calculator: Calculator,
	camera: Camera,
	connections: Connections,
	cover: Cover,
	darv: Darv,
	devices: Devices,
	dewHeater: Dummy,
	dome: Dummy,
	flatPanel: Dummy,
	flatWizard: FlatWizard,
	focuser: Dummy,
	galaxy: Galaxy,
	gps: Dummy,
	guideOutput: Dummy,
	image: ImageWorkspace,
	moon: Moon,
	mount: Mount,
	planet: Planet,
	planetarium: Planetarium,
	power: Dummy,
	rotator: Dummy,
	satellite: Satellite,
	settings: Settings,
	sun: Sun,
	thermometer: Thermometer,
	tppa: Tppa,
	wheel: Wheel,
} as const satisfies Record<HomePanelType, MemoExoticComponent<({ api }: IDockviewPanelProps) => React.ReactNode>>

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
