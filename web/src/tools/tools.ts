import type { ComponentType } from 'react'
import type { ToolId } from '../shell/route'
import type { IconName } from '../ui/Icon'
import { ArtificialSatellites } from './artificialsatellites/ArtificialSatellitesView'
import { AstronomicalTimeConverter } from './astronomicaltime/AstronomicalTimeConverter'
import { AstroWeather } from './astroweather/AstroWeatherView'
import { Calculator } from './calculator/Calculator'
import { CalibrationLibrary } from './calibrationlibrary/CalibrationLibrary'
import { CloseApproaches } from './closeapproaches/CloseApproachesView'
import { FramingView } from './framing/FramingView'
import { ImageStacking } from './imagestacking/ImageStacking'
import { JupiterPlanner } from './jupiter/JupiterPlannerView'
import { LunarEclipseMap } from './lunareclipse/LunarEclipseMap'
import { MeridianFlipView } from './meridianflip/MeridianFlipView'
import { MeteorShowers } from './meteorshowers/MeteorShowersView'
import { MountPointingModel } from './mountpointing/MountPointingModel'
import { MountRemoteControl } from './mountremotecontrol/MountRemoteControl'
import { ObservatoryCamerasView } from './observatorycameras/ObservatoryCamerasView'
import { ObservingPlanner } from './observingplanner/ObservingPlannerView'
import { OrbitalMechanicsExplorer } from './orbitalmechanics/OrbitalMechanicsExplorer'
import { PlanetaryEvents } from './planetaryevents/PlanetaryEventsView'
import { SaturnPlanner } from './saturn/SaturnPlannerView'
import { SolarEclipseMap } from './solareclipse/SolarEclipseMap'
import { SpiceKernelLibrary } from './spicekernels/SpiceKernelLibrary'

// Static registry of the Tools workspace: standalone utilities that need neither a camera view nor an
// image document. The contextual tools and camera operations of Images are not listed
// here; they belong to the selectors of their workspaces. A tool opens at /tools/<id> in the Tools
// workspace; a tool without a view is planned and cannot be opened. A tool backed by a server service,
// such as the Alpaca Server, only shows and controls that service: closing its view never stops it.

// Implementation state: openable, or planned and not openable.
export type ToolStatus = 'available' | 'planned'

// Definition of a standalone tool.
export interface ToolDefinition {
	// Stable identifier, also the URL path segment.
	readonly id: ToolId
	// Display name.
	readonly label: string
	// What the tool does in one short verb phrase, the line of its card: at most 40 characters, so it fits two lines of
	// the narrowest card.
	readonly summary: string
	// One-sentence description with the sources and protocols the tool uses: the tooltip of its card, searched by the
	// filter.
	readonly description: string
	// Words an operator may type to find the tool, never shown: what it covers inside (the calculators of the
	// Calculator), common names and abbreviations (Moon, FOV, ISS), and the protocols and sources it speaks.
	readonly keywords: readonly string[]
	// Card icon.
	readonly icon: IconName
	// Component rendering the tool, including its WorkspaceLayout; absent while the tool is planned.
	readonly view?: ComponentType
}

// Every standalone tool, by id.
export const TOOL_DEFINITIONS: Readonly<Record<ToolId, ToolDefinition>> = {
	calculator: {
		id: 'calculator',
		label: 'Calculator',
		summary: 'Computes field, sampling, exposure.',
		description: 'Field of view, image scale, sampling, and other observing calculations.',
		keywords: [
			'field of view',
			'FOV',
			'image scale',
			'pixel scale',
			'plate scale',
			'arcsec per pixel',
			'focal length',
			'focal ratio',
			'focal reducer',
			'Barlow',
			'sensor',
			'mosaic',
			'panels',
			'overlap',
			'sampling',
			'Nyquist',
			'undersampling',
			'oversampling',
			'FWHM',
			'seeing',
			'diffraction',
			'Airy disk',
			'critical focus',
			'focus zone',
			'exposure',
			'subexposure',
			'integration',
			'stacking gain',
			'star trailing',
			'untracked',
			'500 rule',
			'eyepiece',
			'magnification',
			'exit pupil',
			'true field',
			'aperture',
			'light grasp',
			'central obstruction',
			'resolving power',
			'airmass',
			'extinction',
			'refraction',
			'dew point',
			'frost point',
			'humidity',
		],
		icon: 'calculator',
		view: Calculator,
	},
	'astronomical-time-converter': {
		id: 'astronomical-time-converter',
		label: 'Astronomical Time Converter',
		summary: 'Converts an instant between timescales.',
		description: 'Civil time, Julian dates, timescales, sidereal time, and epochs of any instant.',
		keywords: ['Julian date', 'JD', 'MJD', 'Besselian epoch', 'Julian epoch', 'J2000', 'UTC', 'UT1', 'DUT1', 'TT', 'TAI', 'TDB', 'TCG', 'TCB', 'leap second', 'Unix time', 'timestamp', 'ISO 8601', 'day of year', 'time zone', 'calendar', 'sidereal time', 'LST', 'GMST', 'GAST', 'LMST', 'LAST', 'hour angle', 'IERS'],
		icon: 'clock',
		view: AstronomicalTimeConverter,
	},
	'solar-eclipse-map': {
		id: 'solar-eclipse-map',
		label: 'Solar Eclipse Map',
		summary: 'Maps the path of each solar eclipse.',
		description: 'Path and local circumstances of solar eclipses.',
		keywords: ['Sun', 'Moon', 'totality', 'total', 'annular', 'hybrid', 'partial', 'central line', 'path of totality', 'umbra', 'contacts', 'eclipse magnitude', 'Besselian elements'],
		icon: 'solarEclipse',
		view: SolarEclipseMap,
	},
	'lunar-eclipse-map': {
		id: 'lunar-eclipse-map',
		label: 'Lunar Eclipse Map',
		summary: 'Maps where lunar eclipses are visible.',
		description: 'Visibility and local circumstances of lunar eclipses.',
		keywords: ['Moon', 'blood moon', 'total', 'partial', 'penumbral', 'umbra', 'penumbra', 'contacts', 'eclipse magnitude'],
		icon: 'lunarEclipse',
		view: LunarEclipseMap,
	},
	'close-approaches': {
		id: 'close-approaches',
		label: 'Close Approaches',
		summary: 'Lists asteroid and comet flybys.',
		description: 'Close encounters of asteroids and comets published by JPL, with the object behind each one.',
		keywords: ['asteroid', 'comet', 'NEO', 'near-Earth', 'PHA', 'potentially hazardous', 'flyby', 'closest distance', 'lunar distance', 'LD', 'minor body', 'small body', 'CAD', 'SBDB', 'JPL'],
		icon: 'closeApproach',
		view: CloseApproaches,
	},
	'orbital-mechanics-explorer': {
		id: 'orbital-mechanics-explorer',
		label: 'Orbital Mechanics Explorer',
		summary: 'Builds and plays two-body orbits.',
		description: 'Builds two-body orbits from elements or a state vector, plays them in 3D, and inspects their elements, energy, and geometry.',
		keywords: ['Kepler', 'two-body', 'orbital elements', 'state vector', 'semi-major axis', 'eccentricity', 'inclination', 'periapsis', 'apoapsis', 'perihelion', 'aphelion', 'anomaly', 'hyperbolic', 'parabolic', 'orbital period', 'energy', 'asteroid', 'comet', 'minor body', 'SBDB', 'SPK', '3D', 'simulation'],
		icon: 'orbit',
		view: OrbitalMechanicsExplorer,
	},
	'astro-weather': {
		id: 'astro-weather',
		label: 'Astro Weather',
		summary: 'Rates each night from the forecasts.',
		description: 'Whether a night is worth observing, and when, from free public forecasts and the local Sun and Moon.',
		keywords: ['weather', 'clouds', 'cloud cover', 'forecast', 'seeing', 'transparency', 'wind', 'humidity', 'dew point', 'rain', 'precipitation', 'Moon phase', 'moonlight', 'twilight', 'dark time', 'darkness', 'Open-Meteo', '7Timer'],
		icon: 'cloudMoon',
		view: AstroWeather,
	},
	'observing-planner': {
		id: 'observing-planner',
		label: 'Observing Planner',
		summary: 'Finds the best targets of a night.',
		description: 'Finds the best targets of a night, explains when and why each one is observable, and keeps manual night plans.',
		keywords: ['targets', 'tonight', 'what to observe', 'altitude', 'airmass', 'transit', 'visibility', 'Moon separation', 'plan', 'night plan', 'schedule', 'DSO', 'deep sky', 'galaxy', 'nebula', 'cluster', 'Messier', 'NGC', 'planets', 'asteroid', 'comet', 'minor body'],
		icon: 'compass',
		view: ObservingPlanner,
	},
	framing: {
		id: 'framing',
		label: 'Framing',
		summary: 'Compares fields of view on the sky.',
		description: 'The framings every tool plans with: a telescope and a camera from the Equipment Setup, the Equipment Catalog, AstroBin, or typed, and the rotation of the sensor, compared over the sky catalog or a hips2fits survey image.',
		keywords: ['FOV', 'field of view', 'framing', 'rotation', 'position angle', 'PA', 'sensor', 'telescope', 'camera', 'image scale', 'optical preset', 'hips2fits', 'HiPS', 'survey', 'DSS', 'AstroBin', 'mosaic'],
		icon: 'frame',
		view: FramingView,
	},
	'jupiter-observing-planner': {
		id: 'jupiter-observing-planner',
		label: 'Jupiter Observing Planner',
		summary: 'Times moon events and Red Spot transits.',
		description: 'Transits, shadows, occultations, and eclipses of the Galilean moons and Great Red Spot transits, with when your site can watch them.',
		keywords: ['Galilean moons', 'Io', 'Europa', 'Ganymede', 'Callisto', 'Great Red Spot', 'GRS', 'System II', 'transit', 'shadow transit', 'occultation', 'eclipse', 'mutual events', 'Jovian'],
		icon: 'jupiter',
		view: JupiterPlanner,
	},
	'saturn-observing-planner': {
		id: 'saturn-observing-planner',
		label: 'Saturn Observing Planner',
		summary: 'Shows ring tilt and the major moons.',
		description: 'Ring tilt and ring-plane seasons, and the positions and greatest separations of the seven major moons.',
		keywords: ['rings', 'ring tilt', 'ring opening', 'ring plane crossing', 'moons', 'Titan', 'Rhea', 'Iapetus', 'Dione', 'Tethys', 'Enceladus', 'Mimas', 'greatest elongation', 'transit', 'shadow', 'occultation', 'eclipse', 'mutual events'],
		icon: 'saturn',
		view: SaturnPlanner,
	},
	'planetary-events': {
		id: 'planetary-events',
		label: 'Planetary Events',
		summary: 'Lists conjunctions and oppositions.',
		description: 'Conjunctions, oppositions, elongations, stations, and close approaches of the planets, with when your site can watch them.',
		keywords: ['planets', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'conjunction', 'opposition', 'quadrature', 'elongation', 'greatest elongation', 'appulse', 'station', 'stationary', 'retrograde', 'dichotomy', 'greatest brightness', 'almanac'],
		icon: 'planetAlignment',
		view: PlanetaryEvents,
	},
	'meteor-showers': {
		id: 'meteor-showers',
		label: 'Meteor Showers',
		summary: 'Lists showers, radiants, and rates.',
		description: 'The IAU meteor shower catalog with the major visual showers, their dates and radiants, and when your site can watch them.',
		keywords: ['meteors', 'shooting stars', 'Perseids', 'Geminids', 'Quadrantids', 'Lyrids', 'Eta Aquariids', 'Delta Aquariids', 'Capricornids', 'Draconids', 'Orionids', 'Taurids', 'Leonids', 'Ursids', 'radiant', 'ZHR', 'peak', 'solar longitude', 'population index', 'IMO', 'IAU MDC', 'Meteor Data Center'],
		icon: 'meteor',
		view: MeteorShowers,
	},
	'artificial-satellites': {
		id: 'artificial-satellites',
		label: 'Artificial Satellites',
		summary: 'Predicts passes and ground tracks.',
		description: 'Catalog, passes, ephemerides, and ground tracks of artificial satellites from CelesTrak orbital elements.',
		keywords: ['ISS', 'space station', 'Starlink', 'TLE', 'OMM', 'NORAD', 'COSPAR', 'passes', 'flyover', 'visible passes', 'ground track', 'orbital elements', 'CelesTrak'],
		icon: 'satellite',
		view: ArtificialSatellites,
	},
	'calibration-library': {
		id: 'calibration-library',
		label: 'Calibration Library',
		summary: 'Indexes frames and builds masters.',
		description: 'Indexes calibration frames, explains what can be combined, and builds master darks, biases, dark-flats, and flats.',
		keywords: ['calibration', 'darks', 'flats', 'bias', 'dark flats', 'flat darks', 'master dark', 'master flat', 'master bias', 'dark library', 'sensor temperature', 'gain', 'offset', 'binning', 'FITS', 'XISF'],
		icon: 'archive',
		view: CalibrationLibrary,
	},
	'image-stacking': {
		id: 'image-stacking',
		label: 'Image Stacking',
		summary: 'Stacks lights and composes color.',
		description: 'Groups saved light frames by filter, integrates them, and composes color from mono masters.',
		keywords: ['stack', 'stacking', 'integrate', 'integration', 'lights', 'light frames', 'master', 'registration', 'align', 'rejection', 'sigma clip', 'winsorized', 'HFD', 'FWHM', 'SNR', 'eccentricity', 'RGB', 'LRGB', 'SHO', 'HOO', 'narrowband', 'color', 'combine'],
		icon: 'stack',
		view: ImageStacking,
	},
	'mount-remote-control': {
		id: 'mount-remote-control',
		label: 'Mount Remote Control',
		summary: 'Lets planetarium apps drive the mount.',
		description: 'Lets planetarium programs drive the mount over the LX200 and Stellarium protocols.',
		keywords: ['LX200', 'Stellarium', 'planetarium', 'telescope control', 'remote', 'GoTo', 'slew', 'sync', 'TCP', 'server'],
		icon: 'remote',
		view: MountRemoteControl,
	},
	'mount-pointing-model': {
		id: 'mount-pointing-model',
		label: 'Mount Pointing Model',
		summary: 'Inspects and refits pointing models.',
		description: 'Inspects, refits, and validates the pointing models of the mount.',
		keywords: ['pointing', 'pointing model', 'model', 'alignment', 'sync', 'GoTo accuracy', 'residuals', 'RMS', 'samples', 'plate solving', 'refit'],
		icon: 'pointingModel',
		view: MountPointingModel,
	},
	'meridian-flip': {
		id: 'meridian-flip',
		label: 'Meridian Flip',
		summary: 'Watches the meridian, flips the mount.',
		description: 'Follows the tracked target through the meridian and flips the mount when asked, pausing and resuming the capture and guiding around it.',
		keywords: ['flip', 'meridian flip', 'pier side', 'meridian', 'transit', 'hour angle', 'German equatorial', 'GEM', 'time to flip', 'pause', 'resume'],
		icon: 'meridian',
		view: MeridianFlipView,
	},
	'observatory-cameras': {
		id: 'observatory-cameras',
		label: 'Observatory Cameras',
		summary: 'Shows live video of the observatory.',
		description: 'Live video of the IP security cameras watching the observatory, relayed by the server over WebRTC.',
		keywords: ['CCTV', 'security camera', 'IP camera', 'webcam', 'RTSP', 'RTSPS', 'WebRTC', 'WHEP', 'MediaMTX', 'video', 'live', 'stream', 'all sky', 'allsky'],
		icon: 'cctv',
		view: ObservatoryCamerasView,
	},
	'spice-kernel-library': {
		id: 'spice-kernel-library',
		label: 'SPICE Kernel Library',
		summary: 'Keeps SPK kernels for offline positions.',
		description: 'SPK ephemeris files for accurate positions without asking JPL: planetary kernels from NAIF, asteroids and comets from Horizons, or your own.',
		keywords: ['SPICE', 'SPK', 'BSP', 'ephemeris', 'ephemerides', 'kernel', 'NAIF', 'JPL', 'Horizons', 'DE440', 'DE440s', 'DE442', 'offline', 'planetary moons', 'asteroid', 'comet'],
		icon: 'database',
		view: SpiceKernelLibrary,
	},
	'alpaca-server': {
		id: 'alpaca-server',
		label: 'Alpaca Server',
		summary: 'Publishes devices to Alpaca clients.',
		description: 'Publishes selected devices to ASCOM Alpaca clients on the network.',
		keywords: ['ASCOM', 'Alpaca', 'share devices', 'publish devices', 'network', 'discovery', 'remote devices'],
		icon: 'server',
	},
}

// Returns the implementation state of a tool.
export function toolStatus(tool: Pick<ToolDefinition, 'view'>): ToolStatus {
	return tool.view ? 'available' : 'planned'
}

// Group of the catalog: tools that serve one moment of a night, under one heading.
export interface ToolGroup {
	// Heading of the group.
	readonly label: string
	// Tools of the group, in the order shown.
	readonly tools: readonly ToolId[]
}

// Groups of the catalog in the order of a night: planning it, running the rig, working the frames, and the references
// used at any time. Every tool is in exactly one group.
export const TOOL_GROUPS: readonly ToolGroup[] = [
	{
		label: 'Planning',
		tools: ['astro-weather', 'observing-planner', 'framing', 'planetary-events', 'meteor-showers', 'jupiter-observing-planner', 'saturn-observing-planner', 'artificial-satellites', 'close-approaches', 'solar-eclipse-map', 'lunar-eclipse-map'],
	},
	{ label: 'Rig & Observatory', tools: ['meridian-flip', 'mount-remote-control', 'mount-pointing-model', 'observatory-cameras', 'alpaca-server'] },
	{ label: 'Frames', tools: ['calibration-library', 'image-stacking'] },
	{ label: 'Reference', tools: ['calculator', 'astronomical-time-converter', 'orbital-mechanics-explorer', 'spice-kernel-library'] },
]

// Heading of the group that lifts the tools running work on the server above the groups of the night.
export const RUNNING_GROUP_LABEL = 'Running'

// Returns the groups the catalog shows: the tools that match the filter query, under the groups of TOOL_GROUPS, except
// the tools running reports as running work, which leave their group for a first group of their own (in the order of
// TOOL_GROUPS); a group left empty, the running one included, is not returned.
export function catalogGroups(query: string, running: (id: ToolId) => boolean): ToolGroup[] {
	const shown = TOOL_GROUPS.flatMap((group) => group.tools).filter((id) => matchesTool(TOOL_DEFINITIONS[id], query))
	const lifted = shown.filter(running)
	const groups = TOOL_GROUPS.map((group) => ({ label: group.label, tools: group.tools.filter((id) => shown.includes(id) && !lifted.includes(id)) }))
	return [{ label: RUNNING_GROUP_LABEL, tools: lifted }, ...groups].filter((group) => group.tools.length > 0)
}

// Whether a tool matches a filter: every word of the query, ignoring case and accents, is found in its name, its
// summary, its description, or its keywords. An empty query matches every tool.
export function matchesTool(tool: Pick<ToolDefinition, 'label' | 'summary' | 'description' | 'keywords'>, query: string): boolean {
	const text = foldText(`${tool.label} ${tool.summary} ${tool.description} ${tool.keywords.join(' ')}`)
	return foldText(query)
		.split(/\s+/)
		.filter(Boolean)
		.every((word) => text.includes(word))
}

// Lowercases text and strips its diacritics, so "Júpiter" matches "jupiter".
function foldText(text: string): string {
	return text.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase()
}
