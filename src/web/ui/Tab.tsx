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
import guideOutputIcon from '@assets/guide-output.webp'
import heaterIcon from '@assets/heater.webp'
import mountIcon from '@assets/mount.webp'
import phd2Icon from '@assets/phd2.webp'
import rotatorIcon from '@assets/rotator.webp'
import settingsIcon from '@assets/settings.webp'
import skyIcon from '@assets/sky.webp'
import type { HomePanelType } from '@stores/home.store'
import { Icons } from '@ui/Icon'
import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { useEffect, useState } from 'react'
import { DEVICE_TYPES } from 'root/src/shared/types'

const icons = {
	about: aboutIcon,
	alpaca: alpacaIcon,
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
	galaxy: '',
	gps: '',
	guideOutput: guideOutputIcon,
	guider: phd2Icon,
	image: '',
	moon: '',
	mount: mountIcon,
	planet: '',
	planetarium: skyIcon,
	power: '',
	rotator: rotatorIcon,
	satellite: '',
	settings: settingsIcon,
	sun: '',
	thermometer: '',
	tppa: alignmentIcon,
	wheel: wheelIcon,
} as const satisfies Record<HomePanelType, string>

export function Tab(props: IDockviewPanelHeaderProps) {
	const [title, setTitle] = useState(props.api.title)
	const [active, setActive] = useState(props.api.isActive)
	const isFixed = props.api.tabComponent === 'fixed'
	const type = props.api.component as HomePanelType
	const icon = icons[type]

	useEffect(() => {
		const a = props.api.onDidTitleChange((e) => setTitle(e.title))
		const b = props.api.onDidActiveChange((e) => setActive(e.isActive))

		return () => {
			a.dispose()
			b.dispose()
		}
	}, [])

	return (
		<div className="flex h-full w-full items-center justify-center gap-2 px-2 text-sm">
			{icon && <img src={icon} width={16} height={16} />}
			{(!icon || active || isTitleAlwaysVisible(type)) && <span>{title}</span>}
			{isFixed === false && (active || isCloseButtonAlwaysVisible(type)) && <Icons.CloseCircle color="var(--danger)" className="hover:opacity-90" onClick={() => props.api.close()} />}
		</div>
	)
}

function isTitleAlwaysVisible(type: HomePanelType) {
	return DEVICE_TYPES.has(type as never) || type === 'darv' || type === 'flatWizard'
}

function isCloseButtonAlwaysVisible(type: HomePanelType) {
	return DEVICE_TYPES.has(type as never)
}
