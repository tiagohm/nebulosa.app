import { type Constellation, CONSTELLATION_LIST, CONSTELLATIONS } from 'nebulosa/src/astronomy/coordinates/constellation'

// Catalog designations of the sky catalog: the code of every catalog a name can belong to, how a name is
// displayed ("M 31", "Alp CMa", "Sh 2-281"), and how a search query is read back into a catalog code
// and a bare designation. The generator in `bin` writes names with these codes; the API formats and
// parses them.

// Code of each catalog stored in names.type. Codes are persisted, so existing values never change.
export const CATALOG = {
	NAME: 0,
	NGC: 1,
	IC: 2,
	BAYER: 3,
	FLAMSTEED: 4,
	HD: 5,
	HR: 6,
	HIP: 7,
	M: 8,
	C: 9,
	B: 10,
	SH2: 11,
	LBN: 12,
	LDN: 13,
	MEL: 14,
	CR: 15,
	ARP: 16,
	ABELL: 17,
	PGC: 18,
	TR: 19,
	ST: 20,
	RU: 21,
	UGC: 22,
	CED: 23,
	RCW: 24,
	VDB: 25,
	VV: 26,
	PK: 27,
	PNG: 28,
	ACO: 29,
	ESO: 30,
	SNRG: 31,
	DWB: 32,
	BENNETT: 33,
	DUNLOP: 34,
	HERSCHEL: 35,
	GUM: 36,
	BOCHUM: 37,
	ALESSI: 38,
	ALICANTE: 39,
	ALTER: 40,
	ANTALOVA: 41,
	APRIAMASWILI: 42,
	CL_ARP: 43,
	BARHATOVA: 44,
	BASEL: 45,
	BERKELEY: 46,
	BICA: 47,
	BIURAKAN: 48,
	BLANCO: 49,
	CHUPINA: 50,
	CZERNIK: 51,
	DANKS: 52,
	DIAS: 53,
	DJORG: 54,
	DOLIDZE_DZIM: 55,
	DOLIDZE: 56,
	DUFAY: 57,
	FEINSTEIN: 58,
	FERRERO: 59,
	GRAFF: 60,
	GULLIVER: 61,
	HAFFNER: 62,
	HARVARD: 63,
	HAUTE_PROVENCE: 64,
	HOGG: 65,
	ISKURZDAJAN: 66,
	JOHANSSON: 67,
	KHARCHENKO: 68,
	KING: 69,
	KRON: 70,
	LINDSAY: 71,
	LODEN: 72,
	LYNGA: 73,
	MAMAJEK: 74,
	MOFFAT: 75,
	MRK: 76,
	PAL: 77,
	PISMIS: 78,
	PLATAIS: 79,
	ROSLUND: 80,
	SAURER: 81,
	SHER: 82,
	SKIFF: 83,
	STEPHENSON: 84,
	TERZAN: 85,
	TOMBAUGH: 86,
	TURNER: 87,
	UPGREN: 88,
	WATERLOO: 89,
	WESTERLUND: 90,
	ZWICKY: 91,
} as const

// Code of a catalog.
export type CatalogCode = (typeof CATALOG)[keyof typeof CATALOG]

// Display prefix of each catalog code, including its separator; the bare designation follows it. Bayer
// and Flamsteed designations are followed by the constellation instead, and proper names have none.
const PREFIXES: readonly string[] = [
	'',
	'NGC ',
	'IC ',
	'',
	'',
	'HD ',
	'HR ',
	'HIP ',
	'M ',
	'C ',
	'B ',
	'Sh 2-',
	'LBN ',
	'LDN ',
	'Mel ',
	'Cr ',
	'Arp ',
	'Abell ',
	'PGC ',
	'Tr ',
	'St ',
	'Ru ',
	'UGC ',
	'Ced ',
	'RCW ',
	'vdB ',
	'VV ',
	'PK ',
	'PN G',
	'ACO ',
	'ESO ',
	'SNR G',
	'DWB ',
	'Bennett ',
	'Dunlop ',
	'Herschel ',
	'Gum ',
	'Bochum ',
	'Alessi ',
	'Alicante ',
	'Alter ',
	'Antalova ',
	'Apriamaswili ',
	'Arp ',
	'Barhatova ',
	'Basel ',
	'Berkeley ',
	'Bica ',
	'Biurakan ',
	'Blanco ',
	'Chupina ',
	'Czernik ',
	'Danks ',
	'Dias ',
	'Djorg ',
	'Dolidze-Dzim ',
	'Dolidze ',
	'Dufay ',
	'Feinstein ',
	'Ferrero ',
	'Graff ',
	'Gulliver ',
	'Haffner ',
	'Harvard ',
	'Haute-Provence ',
	'Hogg ',
	'Iskurzdajan ',
	'Johansson ',
	'Kharchenko ',
	'King ',
	'Kron ',
	'Lindsay ',
	'Loden ',
	'Lynga ',
	'Mamajek ',
	'Moffat ',
	'Mrk ',
	'Pal ',
	'Pismis ',
	'Platais ',
	'Roslund ',
	'Saurer ',
	'Sher ',
	'Skiff ',
	'Stephenson ',
	'Terzan ',
	'Tombaugh ',
	'Turner ',
	'Upgren ',
	'Waterloo ',
	'Westerlund ',
	'Zwicky ',
]

// Extra query keywords per catalog code, beyond the trimmed display prefix.
const EXTRA_KEYWORDS: Readonly<Partial<Record<CatalogCode, readonly string[]>>> = {
	[CATALOG.M]: ['Messier'],
	[CATALOG.C]: ['Caldwell'],
	[CATALOG.B]: ['Barnard'],
	[CATALOG.SH2]: ['Sh2-', 'Sh2', 'Sh 2', 'Sharpless'],
	[CATALOG.MEL]: ['Melotte'],
	[CATALOG.CR]: ['Collinder'],
	[CATALOG.TR]: ['Trumpler'],
	[CATALOG.ST]: ['Stock'],
	[CATALOG.RU]: ['Ruprecht'],
	[CATALOG.VDB]: ['vdB', 'van den Bergh'],
	[CATALOG.PNG]: ['PNG', 'PN'],
	[CATALOG.SNRG]: ['SNRG', 'SNR'],
	[CATALOG.HERSCHEL]: ['H400', 'Herschel 400'],
}

// Catalogs whose designations may start with a letter; the others need a digit right after the keyword,
// which keeps "Cr 399" from reading as Caldwell "r 399".
const ALPHANUMERIC_CATALOGS: ReadonlySet<CatalogCode> = new Set([CATALOG.CED, CATALOG.PK, CATALOG.PNG, CATALOG.ACO, CATALOG.ESO, CATALOG.SNRG])

// Order in which designations are preferred as an object's display name: proper name, the classic
// deep-sky catalogs, Bayer and Flamsteed, the main star catalogs, then every other catalog by code.
const DISPLAY_PRIORITY: readonly CatalogCode[] = [CATALOG.NAME, CATALOG.M, CATALOG.C, CATALOG.NGC, CATALOG.IC, CATALOG.BAYER, CATALOG.FLAMSTEED, CATALOG.HIP, CATALOG.HD, CATALOG.HR]

// Greek letters and the three-letter abbreviations used by HYG Bayer designations.
const GREEK_LETTERS: readonly (readonly [string, string])[] = [
	['α', 'Alp'],
	['β', 'Bet'],
	['γ', 'Gam'],
	['δ', 'Del'],
	['ε', 'Eps'],
	['ζ', 'Zet'],
	['η', 'Eta'],
	['θ', 'The'],
	['ι', 'Iot'],
	['κ', 'Kap'],
	['λ', 'Lam'],
	['μ', 'Mu'],
	['ν', 'Nu'],
	['ξ', 'Xi'],
	['ο', 'Omi'],
	['π', 'Pi'],
	['ρ', 'Rho'],
	['σ', 'Sig'],
	['τ', 'Tau'],
	['υ', 'Ups'],
	['φ', 'Phi'],
	['χ', 'Chi'],
	['ψ', 'Psi'],
	['ω', 'Ome'],
]

// Bayer letter abbreviation by lowercase abbreviation or full Greek name, such as "alpha" → "Alp".
const BAYER_LETTERS = new Map<string, string>()

for (const [, abbreviation] of GREEK_LETTERS) BAYER_LETTERS.set(abbreviation.toLowerCase(), abbreviation)
for (const [name, abbreviation] of [
	['alpha', 'Alp'],
	['beta', 'Bet'],
	['gamma', 'Gam'],
	['delta', 'Del'],
	['epsilon', 'Eps'],
	['zeta', 'Zet'],
	['theta', 'The'],
	['iota', 'Iot'],
	['kappa', 'Kap'],
	['lambda', 'Lam'],
	['omicron', 'Omi'],
	['sigma', 'Sig'],
	['upsilon', 'Ups'],
	['omega', 'Ome'],
] as const)
	BAYER_LETTERS.set(name, abbreviation)

// Constellation by lowercase IAU abbreviation, such as "cma" → "CMA".
const CONSTELLATIONS_BY_IAU = new Map<string, Constellation>(CONSTELLATION_LIST.map((c) => [CONSTELLATIONS[c].iau.toLowerCase(), c]))

// Query keyword of a catalog, matched case-insensitively at the start of a query.
interface CatalogKeyword {
	// Keyword text, such as "NGC" or "Sh 2-".
	readonly keyword: string
	// Catalog the keyword selects.
	readonly code: CatalogCode
}

// Every catalog keyword, longest first so that "Mel" wins over "M" and "Sh 2-" over "Sh 2".
const KEYWORDS: readonly CatalogKeyword[] = buildKeywords()

// Builds the keyword table from the display prefixes and the extra keywords.
function buildKeywords(): CatalogKeyword[] {
	const keywords: CatalogKeyword[] = []

	for (let code = 0; code < PREFIXES.length; code++) {
		const prefix = PREFIXES[code].trim()
		const extra = EXTRA_KEYWORDS[code as CatalogCode] ?? []
		for (const keyword of new Set([prefix, ...extra])) if (keyword) keywords.push({ keyword, code: code as CatalogCode })
	}

	return keywords.sort((a, b) => b.keyword.length - a.keyword.length)
}

// Designation read from a search query.
export interface ParsedDesignation {
	// Catalog the designation belongs to.
	readonly type: CatalogCode
	// Bare designation as stored in names.name, such as "31" or "Alp-1".
	readonly name: string
	// Constellation of a Bayer or Flamsteed designation.
	readonly constellation?: Constellation
	// Whether a Bayer designation without a superscript also matches its numbered components, so
	// "Pi Ori" finds "Pi-1 Ori" through "Pi-6 Ori".
	readonly components?: boolean
}

// Returns the display prefix of a catalog code; empty for proper names, Bayer, Flamsteed, and unknown codes.
export function catalogPrefix(type: number) {
	return PREFIXES[type] ?? ''
}

// Formats a stored designation for display: "M 31", "Alp CMa", "58 Ori", or the proper name itself.
// constellation is the object's index into CONSTELLATION_LIST.
export function formatDesignation(type: number, name: string, constellation: number) {
	if (type === CATALOG.BAYER || type === CATALOG.FLAMSTEED) {
		const abbreviation = CONSTELLATIONS[CONSTELLATION_LIST[constellation]]?.iau
		return abbreviation ? `${name} ${abbreviation}` : name
	}

	return `${catalogPrefix(type)}${name}`
}

// Returns the IAU abbreviation of a constellation index, such as 9 → "CMa"; undefined when out of range.
export function constellationAbbreviation(constellation: number): string | undefined {
	return CONSTELLATIONS[CONSTELLATION_LIST[constellation]]?.iau
}

// Ranks a catalog code for display-name choice; lower is preferred.
export function displayPriority(type: number) {
	const index = DISPLAY_PRIORITY.indexOf(type as CatalogCode)
	return index >= 0 ? index : DISPLAY_PRIORITY.length + type
}

// Reads a search query as catalog designations. A query may match more than one catalog (Arp galaxies
// and Arp clusters share their prefix), so every candidate is returned; an empty array means the query
// is not a designation and should be searched as a proper name.
export function parseDesignationQuery(query: string): ParsedDesignation[] {
	const text = query.trim().replaceAll(/\s+/g, ' ')
	if (!text) return []

	const stellar = parseStellarDesignation(text)
	if (stellar) return [stellar]

	const result: ParsedDesignation[] = []
	const lower = text.toLowerCase()

	for (const { keyword, code } of KEYWORDS) {
		if (code === CATALOG.NAME || !lower.startsWith(keyword.toLowerCase())) continue

		const name = text.slice(keyword.length).replace(/^[\s-]+/, '')
		if (!name || /\s/.test(name)) continue
		if (!(ALPHANUMERIC_CATALOGS.has(code) ? /^[0-9a-z]/i : /^\d/).test(name)) continue
		if (result.some((e) => e.type === code)) continue

		result.push({ type: code, name })
	}

	return result
}

// Reads a Flamsteed ("58 Ori") or Bayer ("Alp CMa", "α CMa", "alpha CMa", "Pi1 Ori", "Pi-1 Ori")
// designation followed by a constellation's IAU abbreviation; undefined for anything else.
function parseStellarDesignation(text: string): ParsedDesignation | undefined {
	const flamsteed = /^(\d+) ([A-Za-z]{3})$/.exec(text)

	if (flamsteed) {
		const constellation = CONSTELLATIONS_BY_IAU.get(flamsteed[2].toLowerCase())
		return constellation && { type: CATALOG.FLAMSTEED, name: flamsteed[1], constellation }
	}

	const match = /^([^\d\s-]+)[\s-]?(\d)? ([A-Za-z]{3})$/.exec(text)
	if (!match) return undefined

	const constellation = CONSTELLATIONS_BY_IAU.get(match[3].toLowerCase())
	if (!constellation) return undefined

	const letter = match[1]
	const superscript = match[2]
	const greek = GREEK_LETTERS.find((e) => e[0] === letter)?.[1]
	const bayer = greek ?? BAYER_LETTERS.get(letter.toLowerCase())
	if (!bayer) return undefined

	return superscript ? { type: CATALOG.BAYER, name: `${bayer}-${superscript}`, constellation } : { type: CATALOG.BAYER, name: bayer, constellation, components: true }
}

// Converts a Bayer name with a leading Greek letter, as written in Stellarium names, to the HYG
// abbreviation: "α Cen" → "Alp Cen". Other names are returned unchanged.
export function abbreviateGreekLetter(name: string) {
	const letter = GREEK_LETTERS.find((e) => name.startsWith(e[0]))
	return letter ? `${letter[1]} ${name.slice(letter[0].length).trim()}` : name
}
