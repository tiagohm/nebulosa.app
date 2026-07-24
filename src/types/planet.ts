export const PLANET_TYPES = [
	'planet',
	'dwarfPlanet',
	'asteroid',
	'comet',
	'martianSatellite',
	'jovianRegularSatellite',
	'jovianIrregularSatellite',
	'saturnianRegularSatellite',
	'saturnianInnerSatellite',
	'saturnianIrregularSatellite',
	'uranianRegularSatellite',
	'uranianInnerSatellite',
	'uranianIrregularSatellite',
	'neptunianSatellite',
	'neptunianIrregularSatellite',
	'plutoSatellite',
] as const

export type PlanetType = (typeof PLANET_TYPES)[number]
