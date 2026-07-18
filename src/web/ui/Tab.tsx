import aboutIcon from '@assets/about.webp'
import alignmentIcon from '@assets/alignment.webp'
import alpacaIcon from '@assets/alpaca.webp'
import asteroidIcon from '@assets/asteroid.webp'
import autoFocusIcon from '@assets/auto-focus.webp'
import calculatorIcon from '@assets/calculator.webp'
import cameraIcon from '@assets/camera.webp'
import connectionsIcon from '@assets/connections.webp'
import coverIcon from '@assets/cover.webp'
import devicesIcon from '@assets/devices.webp'
import wheelIcon from '@assets/filter-wheel.webp'
import flatPanelIcon from '@assets/flat-panel.webp'
import flatWizardIcon from '@assets/flat-wizard.webp'
import focuserIcon from '@assets/focuser.webp'
import framingIcon from '@assets/framing.webp'
import galaxyIcon from '@assets/galaxy.webp'
import guideOutputIcon from '@assets/guide-output.webp'
import heaterIcon from '@assets/heater.webp'
import imageIcon from '@assets/image.webp'
import indiIcon from '@assets/indi.webp'
import moonIcon from '@assets/moon.webp'
import mountIcon from '@assets/mount.webp'
import phd2Icon from '@assets/phd2.webp'
import planetIcon from '@assets/planet.webp'
import rotatorIcon from '@assets/rotator.webp'
import satelliteIcon from '@assets/satellite.webp'
import settingsIcon from '@assets/settings.webp'
import skyIcon from '@assets/sky.webp'
import solarEclipseIcon from '@assets/solar.eclipse.webp'
import sunIcon from '@assets/sun.webp'
import thermometerIcon from '@assets/thermometer.webp'
import type { HomePanelType } from '@stores/home.store'
import { Icons } from '@ui/Icon'
import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { useEffect, useState } from 'react'
import { DEVICE_TYPES } from 'root/src/shared/types'

const icons = {
	about: aboutIcon,
	alpacaServer: alpacaIcon,
	asteroid: asteroidIcon,
	autoFocus: autoFocusIcon,
	calculator: calculatorIcon,
	camera: cameraIcon,
	connections: connectionsIcon,
	cover: coverIcon,
	darv: alignmentIcon,
	devices: devicesIcon,
	dewHeater: heaterIcon,
	dome: '',
	flatPanel: flatPanelIcon,
	flatWizard: flatWizardIcon,
	focuser: focuserIcon,
	framing: framingIcon,
	galaxy: galaxyIcon,
	gps: '',
	guideOutput: guideOutputIcon,
	guider: phd2Icon,
	image: imageIcon,
	moon: moonIcon,
	mount: mountIcon,
	planet: planetIcon,
	planetarium: skyIcon,
	power: '',
	rotator: rotatorIcon,
	satellite: satelliteIcon,
	settings: settingsIcon,
	sun: sunIcon,
	thermometer: thermometerIcon,
	tppa: alignmentIcon,
	wheel: wheelIcon,
	solarEclipse: solarEclipseIcon,
	indiServer: indiIcon,
} as const satisfies Record<HomePanelType, string>

export function Tab(props: IDockviewPanelHeaderProps) {
	const [title, setTitle] = useState(props.api.title)
	const [active, setActive] = useState(props.api.isActive)
	const [visible, setVisible] = useState(props.api.isVisible)
	const isFixed = props.api.tabComponent === 'fixed'
	const type = props.api.component as HomePanelType
	const icon = icons[type]

	useEffect(() => {
		const a = props.api.onDidTitleChange((e) => setTitle(e.title))
		const b = props.api.onDidActiveChange((e) => setActive(e.isActive))
		const c = props.api.onDidVisibilityChange((e) => setVisible(e.isVisible))

		return () => {
			a.dispose()
			b.dispose()
			c.dispose()
		}
	}, [])

	return (
		<div className="flex h-full w-full items-center justify-center gap-2 px-2 text-sm">
			{icon && <img src={icon} width={16} height={16} />}
			{(!icon || active || visible || isTitleAlwaysVisible(type)) && <span>{title}</span>}
			{isFixed === false && (active || visible || isCloseButtonAlwaysVisible(type)) && <Icons.CloseCircle color="var(--danger)" className="hover:opacity-90" onClick={() => props.api.close()} />}
		</div>
	)
}

function isTitleAlwaysVisible(type: HomePanelType) {
	return DEVICE_TYPES.has(type as never) || type === 'darv' || type === 'flatWizard'
}

function isCloseButtonAlwaysVisible(type: HomePanelType) {
	return DEVICE_TYPES.has(type as never)
}
