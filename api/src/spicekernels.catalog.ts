// Reviewed NAIF downloads of the SPICE Kernel Library. A download is asked for by the id of an entry, never by a URL,
// so the server only fetches these exact HTTPS files. Each one is an SPK whose segments the server can evaluate
// (data type 2, J2000 frame), checked against the file before it was listed.

// A curated SPK file of the NAIF generic kernels.
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

// Curated downloads, the recommended planetary ephemeris first.
export const SPICE_KERNEL_CATALOG: readonly SpiceCatalogEntry[] = [
	{
		id: 'de440s',
		name: 'de440s.bsp',
		description: 'JPL DE440 planetary ephemeris, 1849 to 2150: the solar-system barycenter, the planetary system barycenters, the Sun, Mercury, Venus, the Earth, and the Moon.',
		url: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp',
		bytes: 32726016,
	},
]
