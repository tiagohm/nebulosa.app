import { homeStore, type HomePanelType } from '@stores/home.store'
import { About } from '@ui/About'
import { Alpaca } from '@ui/Alpaca'
import { Asteroid } from '@ui/Asteroid'
import { AutoFocus } from '@ui/AutoFocus'
import { Calculator } from '@ui/Calculator'
import { Camera } from '@ui/Camera'
import { Confirmation } from '@ui/Confirmation'
import { Connections } from '@ui/Connections'
import { Cover } from '@ui/Cover'
import { Darv } from '@ui/Darv'
import { Devices } from '@ui/Devices'
import { DewHeater } from '@ui/DewHeater'
import { FlatPanel } from '@ui/FlatPanel'
import { FlatWizard } from '@ui/FlatWizard'
import { Focuser } from '@ui/Focuser'
import { Framing } from '@ui/Framing'
import { Galaxy } from '@ui/Galaxy'
import { Guider } from '@ui/Guider'
import { ImageWorkspace } from '@ui/ImageWorkspace'
import { Moon } from '@ui/Moon'
import { Mount } from '@ui/Mount'
import { Planet } from '@ui/Planet'
import { Planetarium } from '@ui/Planetarium'
import { Satellite } from '@ui/Satellite'
import { Settings } from '@ui/Settings'
import { Sun } from '@ui/Sun'
import { Tab } from '@ui/Tab'
import { Thermometer } from '@ui/Thermometer'
import { Tppa } from '@ui/Tppa'
import { Wheel } from '@ui/Wheel'
import { DockviewReact, themeGithubDark, type IDockviewPanelProps } from 'dockview-react'
import { memo, useEffect, type MemoExoticComponent } from 'react'
import { wsStore } from 'src/web/stores/ws.store'

const tabComponents = {
	fixed: Tab,
	closeable: Tab,
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
	dewHeater: DewHeater,
	dome: Dummy,
	flatPanel: FlatPanel,
	flatWizard: FlatWizard,
	focuser: Focuser,
	framing: Framing,
	galaxy: Galaxy,
	gps: Dummy,
	guideOutput: Dummy,
	guider: Guider,
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
			<header className="flex flex-row justify-center p-0"></header>
			<div className="min-h-0">
				<DockviewReact hideBorders scrollbars="native" defaultTabComponent={Tab} theme={themeGithubDark} className="h-full w-full" tabComponents={tabComponents} components={components} onReady={homeStore.handleReady} />
				<Confirmation />
			</div>
		</div>
	)
})
