import { atlasStore } from '@stores/atlas.store'
import { homeStore } from '@stores/home.store'
import type { HomePanelType } from '@stores/home.store'
import { settingsStore } from '@stores/settings.store'
import { About } from '@ui/About'
import { AlpacaServer } from '@ui/AlpacaServer'
import { Asteroid } from '@ui/Asteroid'
import { AutoFocus } from '@ui/AutoFocus'
import { Calculator } from '@ui/Calculator'
import { Camera } from '@ui/Camera'
import { IconButton } from '@ui/components/IconButton'
import { List, ListItem } from '@ui/components/List'
import { Popover } from '@ui/components/Popover'
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
import { GuideOutput } from '@ui/GuideOutput'
import { Guider } from '@ui/Guider'
import { Icons } from '@ui/Icon'
import { ImageHome } from '@ui/ImageHome'
import { ImagePickerButton } from '@ui/ImagePickerButton'
import { IndiServer } from '@ui/IndiServer'
import { LunarEclipseMap } from '@ui/LunarEclipseMap'
import { Moon } from '@ui/Moon'
import { Mount } from '@ui/Mount'
import { Planet } from '@ui/Planet'
import { Planetarium } from '@ui/Planetarium'
import { Rotator } from '@ui/Rotator'
import { Satellite } from '@ui/Satellite'
import { Settings } from '@ui/Settings'
import { SolarEclipseMap } from '@ui/SolarEclipseMap'
import { Sun } from '@ui/Sun'
import { homeIcons, Tab } from '@ui/Tab'
import { Thermometer } from '@ui/Thermometer'
import { Tppa } from '@ui/Tppa'
import { Wheel } from '@ui/Wheel'
import { DockviewReact, themeGithubDark } from 'dockview-react'
import type { IDockviewHeaderActionsProps, IDockviewPanelProps } from 'dockview-react'
import { memo, useEffect } from 'react'

const tabComponents = {
	fixed: Tab,
	closeable: Tab,
	image: Tab,
} as const

const Dummy = () => <div></div>

const components = {
	about: About,
	alpacaServer: AlpacaServer,
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
	guideOutput: GuideOutput,
	guider: Guider,
	image: ImageHome,
	indiServer: IndiServer,
	lunarEclipse: LunarEclipseMap,
	moon: Moon,
	mount: Mount,
	planet: Planet,
	planetarium: Planetarium,
	power: Dummy,
	rotator: Rotator,
	satellite: Satellite,
	settings: Settings,
	solarEclipse: SolarEclipseMap,
	sun: Sun,
	thermometer: Thermometer,
	tppa: Tppa,
	wheel: Wheel,
} as const satisfies Record<HomePanelType, React.FunctionComponent<IDockviewPanelProps>>

export const Home = memo(() => {
	// Mounts the store lifecycle once the home screen is active.
	useEffect(settingsStore.mount, [])
	useEffect(atlasStore.mount, [])
	useEffect(homeStore.mount, [])

	return (
		<div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] p-1 text-white">
			<header className="flex flex-row justify-center p-0"></header>
			<div className="min-h-0">
				<DockviewReact hideBorders rightHeaderActionsComponent={RightHeaderAction} defaultTabComponent={Tab} theme={themeGithubDark} className="h-full w-full" tabComponents={tabComponents} components={components} onReady={homeStore.handleReady} />
				<Confirmation />
			</div>
		</div>
	)
})

const RightHeaderAction = memo((props: IDockviewHeaderActionsProps) => {
	const group = props.activePanel?.group.id
	return group === 'group.main' ? <MainGroupAction /> : null
})

const MAIN_GROUP_ACTIONS = [
	{ label: 'Guider', icon: homeIcons.guider, action: () => homeStore.addGuider() },
	{ label: 'Auto Focus', icon: homeIcons.autoFocus, action: () => homeStore.addAutoFocus() },
	{ label: 'DARV', icon: homeIcons.darv, action: () => homeStore.addDarv() },
	{ label: 'TPPA', icon: homeIcons.tppa, action: () => homeStore.addTppa() },
	{ label: 'Flat Wizard', icon: homeIcons.flatPanel, action: () => homeStore.addFlatWizard() },
	{ label: 'Framing', icon: homeIcons.framing, action: () => homeStore.addFraming() },
	{ label: 'Calculator', icon: homeIcons.calculator, action: () => homeStore.addCalculator() },
	{ label: 'Planetarium', icon: homeIcons.planetarium, action: () => homeStore.addPlanetarium() },
	{ label: 'Sun', icon: homeIcons.sun, action: () => homeStore.addSun() },
	{ label: 'Moon', icon: homeIcons.moon, action: () => homeStore.addMoon() },
	{ label: 'Planet', icon: homeIcons.planet, action: () => homeStore.addPlanet() },
	{ label: 'Asteroid', icon: homeIcons.asteroid, action: () => homeStore.addAsteroid() },
	{ label: 'DSO', icon: homeIcons.galaxy, action: () => homeStore.addDSO() },
	{ label: 'Satellite', icon: homeIcons.satellite, action: () => homeStore.addSatellite() },
	{ label: 'Solar Eclipse', icon: homeIcons.solarEclipse, action: () => homeStore.addSolarEclipse() },
	{ label: 'Lunar Eclipse', icon: homeIcons.lunarEclipse, action: () => homeStore.addLunarEclipse() },
] as const

const MainGroupAction = memo(() => {
	function handleAction(index: number) {
		MAIN_GROUP_ACTIONS[index].action()
	}

	return (
		<div className="flex flex-row items-center gap-2">
			<ImagePickerButton />
			<Popover classNames={{ content: 'p-0' }} trigger={<IconButton icon={Icons.VerticalMenu} />}>
				<List fullWidth className="min-w-80" onAction={handleAction}>
					{MAIN_GROUP_ACTIONS.map(({ label, icon }) => (
						<ListItem key={label} className="cursor-pointer" label={label} startContent={<img src={icon} width={16} height={16} />} />
					))}
				</List>
			</Popover>
		</div>
	)
})
