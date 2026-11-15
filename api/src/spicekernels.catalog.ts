// Reviewed NASA/JPL downloads of the SPICE Kernel Library. A download is asked for by the id of an entry, never by a URL,
// so the server only fetches these exact HTTPS files. Each one is an SPK whose bodies the server can evaluate (data type
// 2, 3, or 17, J2000 frame), checked against the file before it was listed. Their size is not limited: the toolkit reads a
// file record by record, never whole.

// Planetary system a curated kernel belongs to, by which the Add Kernel section groups and filters them: the planetary
// ephemerides, then the satellite ephemerides of each planet with moons.
export type SpiceCatalogSystem = 'planets' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto'

// A curated SPK file of the NAIF or JPL Solar System Dynamics archives.
export interface SpiceCatalogEntry {
	// Stable id, sent to download it.
	readonly id: string
	// File name shown to people.
	readonly name: string
	// Planetary system it provides.
	readonly system: SpiceCatalogSystem
	// The bodies it provides, in a few words.
	readonly bodies: string
	// First and last calendar years (TDB) its segments cover, rounded to the nearest year.
	readonly startYear: number
	readonly endYear: number
	// What else it provides or needs: its dependencies, its provenance, and its size when large.
	readonly description: string
	// Exact HTTPS URL of the file.
	readonly url: string
	// Size of the file as published, in bytes; the progress uses the response length when present.
	readonly bytes: number
}

// URL of the NAIF generic planetary ephemerides.
const NAIF_PLANETS = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets'

// URL of the NAIF generic satellite ephemerides.
const NAIF_SATELLITES = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites'

// URL of the satellite ephemerides of the JPL Solar System Dynamics group, used for the files NAIF does not publish.
const SSD_SATELLITES = 'https://ssd.jpl.nasa.gov/ftp/eph/satellites/bsp'

// What a satellite kernel with its own planetary segments provides beyond its moons.
const OWN_PLANETARY = 'With its own segments of the Sun, the Earth, and the Earth-Moon and planetary barycenters, so it resolves its bodies alone.'

// What a satellite kernel without planetary segments needs.
const NEEDS_PLANETARY = 'Holds only the moons and the planet relative to the planetary barycenter, so positions also need a planetary kernel such as de440s.bsp.'

// Curated downloads by system, the recommended file of each system first.
//
// The Jovian JUICE kernel is the NAIF JUP365 satellite ephemeris reduced to 1990-2050 (SHA-256 b871790f…13ecc09),
// inspected before listing: type 2 J2000 segments of the Sun, the Earth-Moon barycenter, the Earth, the Jovian
// barycenter, Jupiter's centre and its inner and Galilean satellites, so it resolves every body of a Jovian computation
// alone.
//
// The Saturnian kernels sat480 and sat441 were inspected on 2026-11-07, their MD5 matching NAIF's aa_checksums.txt:
// - sat480.bsp (SHA-256 12d2cfd8…c6daf32): type 2 J2000 segments of the Sun, the Earth-Moon barycenter, the Earth,
//   the Saturnian barycenter and Saturn's centre over 1950-2050, enough for the Saturn Observing Planner's rings, plus
//   one type 17 segment of the small moon S/2009 S 2 relative to Saturn's centre;
// - sat441.bsp (SHA-256 d7e444a9…96444d5): type 2 J2000 segments of the same planetary bodies, Saturn's centre and
//   Mimas to Phoebe with Helene, Telesto, Calypso, Methone and Polydeuces over 1749-2250, enough for the planner's
//   rings and seven major moons alone. NAIF publishes no smaller kernel of the major moons.
//
// The other entries were inspected on 2026-11-15 from the DAF file record and every summary record of the published
// file, read through HTTP ranges, with its exact length: every segment is J2000 and of type 2, but the type 3 segments
// of sat415.bsp and the three type 17 segments of Daphnis relative to Saturn's centre in sat393_daphnis.bsp. The aa_checksums.txt of NAIF's planets and satellites folders gave these MD5 at that date:
// - de440.bsp c9d581bfd84209dbeee8b1583939b148, de442.bsp 446656322267e7b819a26cb08a0d8718,
//   de442s.bsp cc49327e06088124c0e39d8dde9f0b58;
// - mar099s.bsp fd7302dfbaa0c63ce85b1e98923ee6a1, mar099.bsp 46f5740f86ec78b978ab96a82f0e42b7;
// - jup365.bsp 9dcee11a333945310db8b76eb695fc9c, jup347.bsp 5d0fb1232055f44c0aa9a11f130fbd83, jup348.bsp a19ec916c95267772d5f261dc248b1dd,
//   jup349.bsp c7ef9d1829bb39bbbc2ba30d4a5a8a05;
// - sat415.bsp c6bdcf653ccbb072ab540bc6e2581ca8, sat393_daphnis.bsp beea6ecc195cfe0edef4289d59438df1, sat455.bsp 8ef323b67972ba4ecc26bf12d1914401,
//   sat456.bsp 4c66748ca3209d0e66ff29954ab1ee64, sat457.bsp 1b5c6b5bf8aece9d1fed979f06140f11,
//   sat459.bsp bcaab4a0eec7195501116701295d8697;
// - ura184_part-1.bsp ec51c999ea103e0fb485487fb10be03d, ura184_part-2.bsp 1adbbd31608f0da812d99c0d4e1ba686,
//   ura184_part-3.bsp cf24471fb9037543cdbe168bc0fd4c2e;
// - nep097.bsp 937e05462aac5e34cb5cfddae6c99199, nep098_part-1.bsp e83c4bf7d362822d35fd6159f4f3a319,
//   nep098_part-2.bsp 940f7b2bea8433a384b3dd680c92381b, nep098_part-3.bsp e4cfc914088b3b71691cc07e9c0d8215,
//   nep104.bsp fcc219e730cef79a3a239d1e6b74cd55, nep105.bsp 2c32f77dd972c1a7d80e0c57d9cde2e9;
// - plu060.bsp 9e8d40339d583273feb94bbf8c95cae4.
// ura182.bsp and ura117.bsp come from the SSD group, which publishes no checksum; NAIF publishes neither. NAIF splits
// URA184 and NEP098 in parts of disjoint moons, each with its own planetary segments, which the SSD group publishes whole
// without them; the parts are listed.
//
// Left out: the extra-long xl files of single moons, without planetary segments and spanning -13000 to 17000, beyond every
// listed planetary ephemeris; and the SSD copies of the NAIF files above.
export const SPICE_KERNEL_CATALOG: readonly SpiceCatalogEntry[] = [
	{
		id: 'de440s',
		name: 'de440s.bsp',
		system: 'planets',
		bodies: 'Sun, Mercury, Venus, Earth, Moon, planetary barycenters',
		startYear: 1849,
		endYear: 2150,
		description: 'JPL DE440 planetary ephemeris, the recommended one: the solar-system barycenter, the planetary system barycenters, the Sun, Mercury, Venus, the Earth, and the Moon.',
		url: `${NAIF_PLANETS}/de440s.bsp`,
		bytes: 32726016,
	},
	{
		id: 'de440',
		name: 'de440.bsp',
		system: 'planets',
		bodies: 'Sun, Mercury, Venus, Earth, Moon, planetary barycenters',
		startYear: 1550,
		endYear: 2650,
		description: 'JPL DE440 planetary ephemeris over its full span, the same bodies as de440s.bsp.',
		url: `${NAIF_PLANETS}/de440.bsp`,
		bytes: 119799808,
	},
	{
		id: 'de442s',
		name: 'de442s.bsp',
		system: 'planets',
		bodies: 'Sun, Mercury, Venus, Earth, Moon, planetary barycenters',
		startYear: 1849,
		endYear: 2150,
		description: 'JPL DE442 planetary ephemeris, the 2025 update of DE440, with the same bodies.',
		url: `${NAIF_PLANETS}/de442s.bsp`,
		bytes: 32701440,
	},
	{
		id: 'de442',
		name: 'de442.bsp',
		system: 'planets',
		bodies: 'Sun, Mercury, Venus, Earth, Moon, planetary barycenters',
		startYear: 1550,
		endYear: 2650,
		description: 'JPL DE442 planetary ephemeris over its full span, the same bodies as de442s.bsp.',
		url: `${NAIF_PLANETS}/de442.bsp`,
		bytes: 119771136,
	},
	{
		id: 'mar099s',
		name: 'mar099s.bsp',
		system: 'mars',
		bodies: 'Mars, Phobos, Deimos',
		startYear: 1995,
		endYear: 2050,
		description: `JPL MAR099 Martian satellite ephemeris, the short version of mar099.bsp. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/mar099s.bsp`,
		bytes: 67594240,
	},
	{
		id: 'mar099',
		name: 'mar099.bsp',
		system: 'mars',
		bodies: 'Mars, Phobos, Deimos',
		startYear: 1600,
		endYear: 2600,
		description: `JPL MAR099 Martian satellite ephemeris over its full span. ${OWN_PLANETARY} A download of 1.1 GiB.`,
		url: `${NAIF_SATELLITES}/mar099.bsp`,
		bytes: 1227574272,
	},
	{
		id: 'jup365-1990-2050',
		name: 'jup365_19900101_20500101.bsp',
		system: 'jupiter',
		bodies: 'Jupiter, Io, Europa, Ganymede, Callisto, Amalthea, Thebe, Adrastea, Metis',
		startYear: 1990,
		endYear: 2050,
		description: `JPL JUP365 Jupiter satellite ephemeris reduced for the JUICE mission, enough for the Jupiter Observing Planner on its own. ${OWN_PLANETARY}`,
		url: 'https://naif.jpl.nasa.gov/pub/naif/JUICE/kernels/spk/jup365_19900101_20500101.bsp',
		bytes: 113735680,
	},
	{
		id: 'jup365',
		name: 'jup365.bsp',
		system: 'jupiter',
		bodies: 'Jupiter, Io, Europa, Ganymede, Callisto, Amalthea, Thebe, Adrastea, Metis',
		startYear: 1600,
		endYear: 2200,
		description: `JPL JUP365 Jupiter satellite ephemeris over its full span. ${OWN_PLANETARY} A download of 1.1 GiB.`,
		url: `${NAIF_SATELLITES}/jup365.bsp`,
		bytes: 1136581632,
	},
	{
		id: 'jup347',
		name: 'jup347.bsp',
		system: 'jupiter',
		bodies: 'Jupiter and 90 irregular moons, Himalia to S/2025 J 1',
		startYear: 1800,
		endYear: 2200,
		description: `JPL JUP347 ephemeris of the Jovian irregular satellites, among them Himalia, Elara, Pasiphae, Sinope, Lysithea, Carme, Ananke, and Leda. ${OWN_PLANETARY} A large download.`,
		url: `${NAIF_SATELLITES}/jup347.bsp`,
		bytes: 921358336,
	},
	{
		id: 'jup348',
		name: 'jup348.bsp',
		system: 'jupiter',
		bodies: 'Jupiter and 4 provisional irregular moons',
		startYear: 1799,
		endYear: 2200,
		description: `JPL JUP348 ephemeris of the provisional Jovian irregulars S/2011 J 4, S/2018 J 5, S/2024 J 1, and S/2011 J 5. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/jup348.bsp`,
		bytes: 59772928,
	},
	{
		id: 'jup349',
		name: 'jup349.bsp',
		system: 'jupiter',
		bodies: 'Jupiter and 14 provisional irregular moons',
		startYear: 1799,
		endYear: 2200,
		description: `JPL JUP349 ephemeris of the provisional Jovian irregulars S/2010 J 3 to S/2021 J 8. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/jup349.bsp`,
		bytes: 97525760,
	},
	{
		id: 'sat480',
		name: 'sat480.bsp',
		system: 'saturn',
		bodies: 'Saturn',
		startYear: 1950,
		endYear: 2050,
		description: `JPL SAT480 Saturn ephemeris, enough for the rings of the Saturn Observing Planner on its own; it also holds the small moon S/2009 S 2. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/sat480.bsp`,
		bytes: 12621824,
	},
	{
		id: 'sat441',
		name: 'sat441.bsp',
		system: 'saturn',
		bodies: 'Saturn, Mimas, Enceladus, Tethys, Dione, Rhea, Titan, Hyperion, Iapetus, Phoebe, and 5 small moons',
		startYear: 1749,
		endYear: 2250,
		description: `JPL SAT441 Saturnian satellite ephemeris with Helene, Telesto, Calypso, Methone, and Polydeuces, enough for the Saturn Observing Planner on its own. ${OWN_PLANETARY} A large download.`,
		url: `${NAIF_SATELLITES}/sat441.bsp`,
		bytes: 661592064,
	},
	{
		id: 'sat415',
		name: 'sat415.bsp',
		system: 'saturn',
		bodies: 'Saturn, Janus, Epimetheus, Atlas, Prometheus, Pandora, Pan, Methone, Pallene, Anthe, Aegaeon',
		startYear: 1950,
		endYear: 2050,
		description: `JPL SAT415 ephemeris of the small inner Saturnian moons, fitted to all Cassini data. ${OWN_PLANETARY} A large download.`,
		url: `${NAIF_SATELLITES}/sat415.bsp`,
		bytes: 624325632,
	},
	{
		id: 'sat393-daphnis',
		name: 'sat393_daphnis.bsp',
		system: 'saturn',
		bodies: 'Daphnis',
		startYear: 1950,
		endYear: 2050,
		description: "JPL SAT393 ephemeris of Daphnis, the moon of the Keeler gap, as precessing equinoctial elements relative to Saturn's centre, so positions also need a kernel with Saturn, such as sat480.bsp.",
		url: `${NAIF_SATELLITES}/sat393_daphnis.bsp`,
		bytes: 9216,
	},
	{
		id: 'sat456',
		name: 'sat456.bsp',
		system: 'saturn',
		bodies: 'Saturn and 42 named irregular moons',
		startYear: 1750,
		endYear: 2150,
		description: `JPL SAT456 ephemeris of the Saturnian irregulars recognized by the IAU, among them Ymir, Paaliaq, Tarvos, Ijiraq, Kiviuq, and Mundilfari. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/sat456.bsp`,
		bytes: 120824832,
	},
	{
		id: 'sat457',
		name: 'sat457.bsp',
		system: 'saturn',
		bodies: 'Saturn and 79 provisional irregular moons',
		startYear: 1750,
		endYear: 2150,
		description: `JPL SAT457 ephemeris of the provisional Saturnian irregulars of SAT454. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/sat457.bsp`,
		bytes: 199346176,
	},
	{
		id: 'sat455',
		name: 'sat455.bsp',
		system: 'saturn',
		bodies: 'Saturn and 128 provisional irregular moons',
		startYear: 1750,
		endYear: 2150,
		description: `JPL SAT455 ephemeris of the Saturnian irregulars announced in 2025. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/sat455.bsp`,
		bytes: 291619840,
	},
	{
		id: 'sat459',
		name: 'sat459.bsp',
		system: 'saturn',
		bodies: 'Saturn and 18 provisional irregular moons',
		startYear: 1750,
		endYear: 2150,
		description: `JPL SAT459 ephemeris of the provisional Saturnian irregulars of SAT458. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/sat459.bsp`,
		bytes: 84349952,
	},
	{
		id: 'ura184-part-3',
		name: 'ura184_part-3.bsp',
		system: 'uranus',
		bodies: 'Uranus, Miranda, Ariel, Umbriel, Titania, Oberon, and 10 irregular moons',
		startYear: 1600,
		endYear: 2400,
		description: `JPL URA184 Uranian satellite ephemeris, the part with the major moons and the irregulars Caliban to Ferdinand and S/2023 U 1; parts 1 and 2 hold the small inner moons. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/ura184_part-3.bsp`,
		bytes: 386885632,
	},
	{
		id: 'ura184-part-1',
		name: 'ura184_part-1.bsp',
		system: 'uranus',
		bodies: 'Uranus, Cordelia, Ophelia, Bianca, Cressida, Desdemona, Juliet, Portia',
		startYear: 1900,
		endYear: 2100,
		description: `JPL URA184 Uranian satellite ephemeris, the part with the first seven small inner moons, fitted with JWST data. ${OWN_PLANETARY} A download of 1.9 GiB.`,
		url: `${NAIF_SATELLITES}/ura184_part-1.bsp`,
		bytes: 2062529536,
	},
	{
		id: 'ura184-part-2',
		name: 'ura184_part-2.bsp',
		system: 'uranus',
		bodies: 'Uranus, Rosalind, Belinda, Puck, Perdita, Mab, Cupid, and one provisional moon',
		startYear: 1900,
		endYear: 2100,
		description: `JPL URA184 Uranian satellite ephemeris, the part with the other small inner moons and the provisional moon 75052, fitted with JWST data. ${OWN_PLANETARY} A download of 1.9 GiB.`,
		url: `${NAIF_SATELLITES}/ura184_part-2.bsp`,
		bytes: 2062529536,
	},
	{
		id: 'ura182',
		name: 'ura182.bsp',
		system: 'uranus',
		bodies: 'Uranus, Miranda, Ariel, Umbriel, Titania, Oberon, Puck',
		startYear: 1550,
		endYear: 2650,
		description: `JPL URA182 ephemeris of the major Uranian moons and Puck, from the JPL Solar System Dynamics group. ${NEEDS_PLANETARY} A large download.`,
		url: `${SSD_SATELLITES}/ura182.bsp`,
		bytes: 698004480,
	},
	{
		id: 'ura117',
		name: 'ura117.bsp',
		system: 'uranus',
		bodies: 'Caliban, Sycorax, Prospero, Setebos, Stephano, Trinculo, Francisco, Margaret, Ferdinand, S/2023 U 1',
		startYear: 1600,
		endYear: 2400,
		description: `JPL URA117 ephemeris of the irregular Uranian moons, from the JPL Solar System Dynamics group. ${NEEDS_PLANETARY}`,
		url: `${SSD_SATELLITES}/ura117.bsp`,
		bytes: 20335616,
	},
	{
		id: 'nep097',
		name: 'nep097.bsp',
		system: 'neptune',
		bodies: 'Neptune, Triton',
		startYear: 1600,
		endYear: 2400,
		description: `JPL NEP097 Neptunian satellite ephemeris of Triton. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/nep097.bsp`,
		bytes: 105262080,
	},
	{
		id: 'nep098-part-1',
		name: 'nep098_part-1.bsp',
		system: 'neptune',
		bodies: 'Neptune, Triton, Nereid, Naiad',
		startYear: 1800,
		endYear: 2200,
		description: `JPL NEP098 Neptunian satellite ephemeris, the part with Triton, Nereid, and Naiad; parts 2 and 3 hold the other inner moons. ${OWN_PLANETARY} A large download.`,
		url: `${NAIF_SATELLITES}/nep098_part-1.bsp`,
		bytes: 821838848,
	},
	{
		id: 'nep098-part-2',
		name: 'nep098_part-2.bsp',
		system: 'neptune',
		bodies: 'Neptune, Thalassa, Despina, Galatea',
		startYear: 1800,
		endYear: 2200,
		description: `JPL NEP098 Neptunian satellite ephemeris, the part with Thalassa, Despina, and Galatea. ${OWN_PLANETARY} A download of 1.7 GiB.`,
		url: `${NAIF_SATELLITES}/nep098_part-2.bsp`,
		bytes: 1791917056,
	},
	{
		id: 'nep098-part-3',
		name: 'nep098_part-3.bsp',
		system: 'neptune',
		bodies: 'Neptune, Larissa, Proteus, Hippocamp',
		startYear: 1800,
		endYear: 2200,
		description: `JPL NEP098 Neptunian satellite ephemeris, the part with Larissa, Proteus, and Hippocamp. ${OWN_PLANETARY} A download of 1.7 GiB.`,
		url: `${NAIF_SATELLITES}/nep098_part-3.bsp`,
		bytes: 1791917056,
	},
	{
		id: 'nep105',
		name: 'nep105.bsp',
		system: 'neptune',
		bodies: 'Neptune, Nereid',
		startYear: 1600,
		endYear: 2400,
		description: `JPL NEP105 ephemeris of Nereid, with data through 2021. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/nep105.bsp`,
		bytes: 210456576,
	},
	{
		id: 'nep104',
		name: 'nep104.bsp',
		system: 'neptune',
		bodies: 'Neptune, Halimede, Psamathe, Sao, Laomedeia, Neso, S/2002 N 5, S/2021 N 1',
		startYear: 1600,
		endYear: 2400,
		description: `JPL NEP104 ephemeris of the irregular Neptunian moons. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/nep104.bsp`,
		bytes: 333170688,
	},
	{
		id: 'plu060',
		name: 'plu060.bsp',
		system: 'pluto',
		bodies: 'Pluto, Charon, Nix, Hydra, Kerberos, Styx',
		startYear: 1800,
		endYear: 2200,
		description: `JPL PLU060 ephemeris of Pluto and its moons, after New Horizons. ${OWN_PLANETARY}`,
		url: `${NAIF_SATELLITES}/plu060.bsp`,
		bytes: 135207936,
	},
]
