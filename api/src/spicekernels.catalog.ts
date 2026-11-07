// Reviewed NAIF downloads of the SPICE Kernel Library. A download is asked for by the id of an entry, never by a URL,
// so the server only fetches these exact HTTPS files. Each one is an SPK whose segments the server can evaluate
// (data type 2, J2000 frame), checked against the file before it was listed.

// A curated SPK file of the NAIF archives.
export interface SpiceCatalogEntry {
	// Stable id, sent to download it.
	readonly id: string
	// File name shown to people.
	readonly name: string
	// What it provides and over which span.
	readonly description: string
	// Exact HTTPS URL of the file.
	readonly url: string
	// Size of the file as published, in bytes; the progress uses the response length when present.
	readonly bytes: number
}

// Curated downloads, the recommended planetary ephemeris first. The Jovian kernel is the NAIF JUP365
// satellite ephemeris reduced to 1990-2050 for the JUICE mission (SHA-256 b871790f…13ecc09), inspected
// before listing: type 2 J2000 segments of the Sun, the Earth-Moon barycenter, the Earth, the Jovian
// barycenter, Jupiter's centre and its inner and Galilean satellites, so it resolves every body of a
// Jovian computation alone.
export const SPICE_KERNEL_CATALOG: readonly SpiceCatalogEntry[] = [
	{
		id: 'de440s',
		name: 'de440s.bsp',
		description: 'JPL DE440 planetary ephemeris, 1849 to 2150: the solar-system barycenter, the planetary system barycenters, the Sun, Mercury, Venus, the Earth, and the Moon.',
		url: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp',
		bytes: 32726016,
	},
	{
		id: 'jup365-1990-2050',
		name: 'jup365_19900101_20500101.bsp',
		description: "JPL JUP365 Jupiter satellite ephemeris, 1990 to 2050: Jupiter's centre, Io, Europa, Ganymede, Callisto, Amalthea, Thebe, Adrastea, and Metis, with the Sun, the Earth, and the Jovian and Earth-Moon barycenters, enough for the Jupiter Observing Planner on its own.",
		url: 'https://naif.jpl.nasa.gov/pub/naif/JUICE/kernels/spk/jup365_19900101_20500101.bsp',
		bytes: 113735680,
	},
]
