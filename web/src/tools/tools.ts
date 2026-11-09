import type { ComponentType } from 'react'
import type { ToolId } from '../shell/route'
import type { IconName } from '../ui/Icon'
import { ArtificialSatellites } from './artificialsatellites/ArtificialSatellitesView'
import { AstronomicalTimeConverter } from './astronomicaltime/AstronomicalTimeConverter'
import { AstroWeather } from './astroweather/AstroWeatherView'
import { Calculator } from './calculator/Calculator'
import { CalibrationLibrary } from './calibrationlibrary/CalibrationLibrary'
import { CloseApproaches } from './closeapproaches/CloseApproachesView'
import { ImageStacking } from './imagestacking/ImageStacking'
import { JupiterPlanner } from './jupiter/JupiterPlannerView'
import { LunarEclipseMap } from './lunareclipse/LunarEclipseMap'
import { MeridianFlipMonitorView } from './meridianflip/MeridianFlipMonitorView'
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
	// One-sentence description.
	readonly description: string
	// Card icon.
	readonly icon: IconName
	// Component rendering the tool, including its WorkspaceLayout; absent while the tool is planned.
	readonly view?: ComponentType
}

// Every standalone tool, by id.
export const TOOL_DEFINITIONS: Readonly<Record<ToolId, ToolDefinition>> = {
	calculator: { id: 'calculator', label: 'Calculator', description: 'Field of view, image scale, sampling, and other observing calculations.', icon: 'calculator', view: Calculator },
	'astronomical-time-converter': { id: 'astronomical-time-converter', label: 'Astronomical Time Converter', description: 'Civil time, Julian dates, timescales, sidereal time, and epochs of any instant.', icon: 'clock', view: AstronomicalTimeConverter },
	'solar-eclipse-map': { id: 'solar-eclipse-map', label: 'Solar Eclipse Map', description: 'Path and local circumstances of solar eclipses.', icon: 'solarEclipse', view: SolarEclipseMap },
	'lunar-eclipse-map': { id: 'lunar-eclipse-map', label: 'Lunar Eclipse Map', description: 'Visibility and local circumstances of lunar eclipses.', icon: 'lunarEclipse', view: LunarEclipseMap },
	'close-approaches': { id: 'close-approaches', label: 'Close Approaches', description: 'Close encounters of asteroids and comets published by JPL, with the object behind each one.', icon: 'closeApproach', view: CloseApproaches },
	'orbital-mechanics-explorer': { id: 'orbital-mechanics-explorer', label: 'Orbital Mechanics Explorer', description: 'Builds two-body orbits from elements or a state vector, plays them in 3D, and inspects their elements, energy, and geometry.', icon: 'orbit', view: OrbitalMechanicsExplorer },
	'astro-weather': { id: 'astro-weather', label: 'Astro Weather', description: 'Whether a night is worth observing, and when, from free public forecasts and the local Sun and Moon.', icon: 'cloudMoon', view: AstroWeather },
	'observing-planner': { id: 'observing-planner', label: 'Observing Planner', description: 'Finds the best targets of a night, explains when and why each one is observable, and keeps manual night plans.', icon: 'compass', view: ObservingPlanner },
	'jupiter-observing-planner': { id: 'jupiter-observing-planner', label: 'Jupiter Observing Planner', description: 'Transits, shadows, occultations, and eclipses of the Galilean moons and Great Red Spot transits, with when your site can watch them.', icon: 'jupiter', view: JupiterPlanner },
	'saturn-observing-planner': { id: 'saturn-observing-planner', label: 'Saturn Observing Planner', description: 'Ring tilt and ring-plane seasons, and the positions and greatest separations of the seven major moons.', icon: 'saturn', view: SaturnPlanner },
	'planetary-events': { id: 'planetary-events', label: 'Planetary Events', description: 'Conjunctions, oppositions, elongations, stations, and close approaches of the planets, with when your site can watch them.', icon: 'planetAlignment', view: PlanetaryEvents },
	'meteor-showers': { id: 'meteor-showers', label: 'Meteor Showers', description: 'The IAU meteor shower catalog with the major visual showers, their dates and radiants, and when your site can watch them.', icon: 'meteor', view: MeteorShowers },
	'artificial-satellites': { id: 'artificial-satellites', label: 'Artificial Satellites', description: 'Catalog, passes, ephemerides, and ground tracks of artificial satellites from CelesTrak orbital elements.', icon: 'satellite', view: ArtificialSatellites },
	'calibration-library': { id: 'calibration-library', label: 'Calibration Library', description: 'Indexes calibration frames, explains what can be combined, and builds master darks, biases, dark-flats, and flats.', icon: 'archive', view: CalibrationLibrary },
	'image-stacking': { id: 'image-stacking', label: 'Image Stacking', description: 'Groups saved light frames by filter, integrates them, and composes color from mono masters.', icon: 'stack', view: ImageStacking },
	'mount-remote-control': { id: 'mount-remote-control', label: 'Mount Remote Control', description: 'Lets planetarium programs drive the mount over the LX200 and Stellarium protocols.', icon: 'remote', view: MountRemoteControl },
	'mount-pointing-model': { id: 'mount-pointing-model', label: 'Mount Pointing Model', description: 'Inspects, refits, and validates the pointing models of the mount.', icon: 'pointingModel', view: MountPointingModel },
	'meridian-flip-monitor': { id: 'meridian-flip-monitor', label: 'Meridian Flip', description: 'Follows the tracked target through the meridian and flips the mount when asked, pausing and resuming the capture and guiding around it.', icon: 'meridian', view: MeridianFlipMonitorView },
	'observatory-cameras': { id: 'observatory-cameras', label: 'Observatory Cameras', description: 'Live video of the IP security cameras watching the observatory, relayed by the server over WebRTC.', icon: 'cctv', view: ObservatoryCamerasView },
	'spice-kernel-library': { id: 'spice-kernel-library', label: 'SPICE Kernel Library', description: 'SPK ephemeris files for accurate positions without asking JPL: planetary kernels from NAIF, asteroids and comets from Horizons, or your own.', icon: 'database', view: SpiceKernelLibrary },
	'alpaca-server': { id: 'alpaca-server', label: 'Alpaca Server', description: 'Publishes selected devices to ASCOM Alpaca clients on the network.', icon: 'server' },
}

// Returns the implementation state of a tool.
export function toolStatus(tool: Pick<ToolDefinition, 'view'>): ToolStatus {
	return tool.view ? 'available' : 'planned'
}
