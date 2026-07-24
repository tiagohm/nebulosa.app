import aboutIcon from '@assets/about.webp'
import adjustmentIcon from '@assets/adjustment.webp'
import alignmentIcon from '@assets/alignment.webp'
import alpacaIcon from '@assets/alpaca.webp'
import annotationIcon from '@assets/annotation.webp'
import asteroidIcon from '@assets/asteroid.webp'
import autoFocusIcon from '@assets/auto.focus.webp'
import calculatorIcon from '@assets/calculator.webp'
import calibrationIcon from '@assets/calibration.webp'
import cameraIcon from '@assets/camera.webp'
import connectionIcon from '@assets/connection.webp'
import coordinateGridIcon from '@assets/coordinate.grid.webp'
import cosmeticCorrectionIcon from '@assets/cosmetic.correction.webp'
import coverIcon from '@assets/cover.webp'
import crosshairIcon from '@assets/crosshair.webp'
import curveTransformationIcon from '@assets/curve.transformation.webp'
import debayerIcon from '@assets/debayer.webp'
import deviceIcon from '@assets/device.webp'
import dewHeaterIcon from '@assets/dew.heater.webp'
import filterIcon from '@assets/filter.webp'
import filterWheelIcon from '@assets/filter.wheel.webp'
import flatPanelIcon from '@assets/flat.panel.webp'
import flatWizardIcon from '@assets/flat.wizard.webp'
import focuserIcon from '@assets/focuser.webp'
import fovIcon from '@assets/fov.webp'
import framingIcon from '@assets/framing.webp'
import galaxyIcon from '@assets/galaxy.webp'
import guideOutputIcon from '@assets/guide.output.webp'
import headerIcon from '@assets/header.webp'
import imageIcon from '@assets/image.webp'
import indiIcon from '@assets/indi.webp'
import lunarEclipseIcon from '@assets/lunar.eclipse.webp'
import moonIcon from '@assets/moon.webp'
import mountIcon from '@assets/mount.webp'
import mouseCoordinateIcon from '@assets/mouse.coordinate.webp'
import phd2Icon from '@assets/phd2.webp'
import planetIcon from '@assets/planet.webp'
import planetariumIcon from '@assets/planetarium.webp'
import plateSolverIcon from '@assets/platesolver.webp'
import roiIcon from '@assets/roi.webp'
import rotationIcon from '@assets/rotation.webp'
import rotatorIcon from '@assets/rotator.webp'
import satelliteIcon from '@assets/satellite.webp'
import saveIcon from '@assets/save.webp'
import scnrIcon from '@assets/scnr.webp'
import settingsIcon from '@assets/settings.webp'
import solarEclipseIcon from '@assets/solar.eclipse.webp'
import starDetectionIcon from '@assets/star.detection.webp'
import statisticsIcon from '@assets/statistics.webp'
import stretchIcon from '@assets/stretch.webp'
import sunIcon from '@assets/sun.webp'
import thermometerIcon from '@assets/thermometer.webp'
import type { HomePanelType } from '@stores/home.store'
import type { ImagePanelType } from '@stores/image.home.store'
import { Tooltip } from '@ui/components/Tooltip'
import { Icons } from '@ui/Icon'
import type { DockviewIDisposable, IDockviewPanelHeaderProps } from 'dockview-react'
import { useEffect, useState } from 'react'
import { isDeviceType } from 'src/types/device'

export const homeIcons = {
	about: aboutIcon,
	alpacaServer: alpacaIcon,
	asteroid: asteroidIcon,
	autoFocus: autoFocusIcon,
	calculator: calculatorIcon,
	camera: cameraIcon,
	connections: connectionIcon,
	cover: coverIcon,
	darv: alignmentIcon,
	devices: deviceIcon,
	dewHeater: dewHeaterIcon,
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
	indiServer: indiIcon,
	lunarEclipse: lunarEclipseIcon,
	moon: moonIcon,
	mount: mountIcon,
	planet: planetIcon,
	planetarium: planetariumIcon,
	power: '',
	rotator: rotatorIcon,
	satellite: satelliteIcon,
	settings: settingsIcon,
	solarEclipse: solarEclipseIcon,
	sun: sunIcon,
	thermometer: thermometerIcon,
	tppa: alignmentIcon,
	wheel: filterWheelIcon,
} as const satisfies Record<HomePanelType, string>

export const imageIcons = {
	adjustment: adjustmentIcon,
	annotation: annotationIcon,
	calibration: calibrationIcon,
	coordinateGrid: coordinateGridIcon,
	cosmeticCorrection: cosmeticCorrectionIcon,
	crosshair: crosshairIcon,
	curveTransformation: curveTransformationIcon,
	debayer: debayerIcon,
	filter: filterIcon,
	fov: fovIcon,
	header: headerIcon,
	mouseCoordinate: mouseCoordinateIcon,
	roi: roiIcon,
	rotation: rotationIcon,
	save: saveIcon,
	scnr: scnrIcon,
	settings: settingsIcon,
	solver: plateSolverIcon,
	starDetection: starDetectionIcon,
	statistics: statisticsIcon,
	stretch: stretchIcon,
	viewer: imageIcon,
} as const satisfies Record<ImagePanelType, string>

export function Tab(props: IDockviewPanelHeaderProps) {
	const [title, setTitle] = useState(props.api.title ?? '')
	const [active, setActive] = useState(props.api.isActive)
	const [visible, setVisible] = useState(props.api.isVisible)
	const [colapsed, setColapsed] = useState(props.api.group.api.isCollapsed())

	const show = !colapsed && (active || visible)
	const isFixed = props.api.tabComponent === 'fixed'
	const isImage = props.api.tabComponent === 'image'
	const type = props.api.component as HomePanelType | ImagePanelType
	const icon = homeIcons[type as HomePanelType] ?? imageIcons[type as ImagePanelType]
	const showTitle = !icon || show || isTitleAlwaysVisible(type)
	const showCloseButton = !isFixed && (show || isCloseButtonAlwaysVisible(type))
	const showTooltip = isImage && (title.includes('/') || title.includes('\\') || !showTitle)

	useEffect(() => {
		const u: DockviewIDisposable[] = []
		u[0] = props.api.onDidTitleChange((e) => setTitle(e.title))
		u[1] = props.api.onDidActiveChange((e) => setActive(e.isActive))
		u[2] = props.api.onDidVisibilityChange((e) => setVisible(e.isVisible))
		u[3] = props.api.group.api.onDidCollapsedChange((e) => setColapsed(e.isCollapsed))
		u[4] = props.api.onDidGroupChange(() => setColapsed(props.api.group.api.isCollapsed()))

		return () => {
			for (const d of u) d.dispose()
		}
	}, [])

	return (
		<Tooltip content={title} disabled={!showTooltip}>
			<div className="flex h-full w-full items-center justify-center gap-2 px-2 text-sm">
				{icon && <img src={icon} width={16} height={16} />}
				{showTitle && <span>{showTooltip ? extractFilename(title) : title}</span>}
				{showCloseButton && <Icons.CloseCircle color="var(--danger)" className="hover:opacity-90" onClick={() => props.api.close()} />}
			</div>
		</Tooltip>
	)
}

function extractFilename(path: string) {
	const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
	if (index >= 0) return path.slice(index + 1)
	return path
}

function isTitleAlwaysVisible(type: HomePanelType | ImagePanelType) {
	return isDeviceType(type) || type === 'darv' || type === 'flatWizard' || type === 'autoFocus' || type === 'tppa'
}

function isCloseButtonAlwaysVisible(type: HomePanelType | ImagePanelType) {
	return isDeviceType(type)
}
