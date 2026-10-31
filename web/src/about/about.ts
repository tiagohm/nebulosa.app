import type { AboutInfo } from 'api'
import { fetchJson } from '../http'

// Data of the About page: the identity of the running distribution fetched from the server, the official links of
// the project, the credits of the work it uses, and the plain-text summary copied for bug reports.

// Repository of the application.
export const APP_REPOSITORY_URL = 'https://github.com/tiagohm/nebulosa.app'

// Repository of the nebulosa.ts toolkit, the core submodule.
export const CORE_REPOSITORY_URL = 'https://github.com/tiagohm/nebulosa.ts'

// License of the application, in its repository.
export const LICENSE_URL = 'https://github.com/tiagohm/nebulosa.app/blob/main/LICENSE'

// Text shown for an identity field the running build did not record.
export const NOT_AVAILABLE = 'Not available in this build'

// Credit of work the application reads or ships.
export interface Credit {
	// Name of the service, dataset, or program.
	readonly name: string
	// Who runs or publishes it; absent when that is the name itself.
	readonly owner?: string
	// Page of the work.
	readonly url: string
	// What the application uses it for.
	readonly use: string
	// License of what the application ships or reads, when its publisher states one.
	readonly license?: { readonly name: string; readonly url: string }
	// Acknowledgment or terms the publisher asks to be shown.
	readonly notice?: string
}

// Credits of one kind of work.
export interface CreditGroup {
	// Heading of the group.
	readonly title: string
	// Credits of the group, in the order shown.
	readonly credits: readonly Credit[]
}

// Every external service, dataset, and program the application uses, shown even when the server cannot be reached. Only what
// runs or ships with the application is listed: toolkit adapters no feature uses are not. A new source adds its credit here.
export const CREDIT_GROUPS: readonly CreditGroup[] = [
	{
		title: 'Online Services',
		credits: [
			{ name: 'Open-Meteo', url: 'https://open-meteo.com/', use: 'Hourly weather forecast of Astro Weather.', license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, notice: 'Free tier for non-commercial use.' },
			{ name: '7Timer!', url: 'https://www.7timer.info/', use: 'Seeing and transparency forecast of Astro Weather.', notice: 'Free for non-commercial use. Ye, Q.-Z. 2011, PASP, 123, 113.' },
			{ name: 'Horizons', owner: 'NASA/JPL Solar System Dynamics', url: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html', use: 'Accurate positions of solar system bodies in the Sky.' },
			{ name: 'Small-Body Database', owner: 'NASA/JPL Solar System Dynamics', url: 'https://ssd-api.jpl.nasa.gov/doc/sbdb.html', use: 'Search, orbits, and details of asteroids and comets.' },
			{ name: 'Close Approach Data', owner: 'NASA/JPL Solar System Dynamics', url: 'https://ssd-api.jpl.nasa.gov/doc/cad.html', use: 'Encounters listed by the Close Approaches tool.' },
			{ name: 'SkyBoT', owner: 'LTE, Observatoire de Paris / CNRS (developed by IMCCE)', url: 'https://ssp.imcce.fr/webservices/skybot/', use: 'Solar system objects in the field of Image Annotation.', notice: 'This research has made use of LTE SkyBoT VO tool.' },
			{ name: 'Solar Dynamics Observatory', owner: 'NASA', url: 'https://sdo.gsfc.nasa.gov/', use: 'Latest images of the Sun in the Sun Inspector.', notice: 'Courtesy of NASA/SDO and the AIA, EVE, and HMI science teams.' },
			{ name: 'Space Weather Prediction Center', owner: 'NOAA', url: 'https://www.swpc.noaa.gov/', use: 'Active regions of the Sun in the Sun Inspector.' },
			{ name: 'Earth orientation data', owner: 'IERS, with its USNO mirror', url: 'https://www.iers.org/', use: 'UT1 and polar motion of the whole server.' },
			{ name: 'Nova Astrometry.net', owner: 'Astrometry.net', url: 'https://nova.astrometry.net/', use: 'Optional online plate solving, with your own account.' },
		],
	},
	{
		title: 'Data Included',
		credits: [
			{ name: 'HYG Database', owner: 'David Nash (astronexus)', url: 'https://codeberg.org/astronexus/hyg', use: 'Stars of the sky catalog.', license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' } },
			{ name: 'Stellarium deep-sky catalog', owner: 'Stellarium', url: 'https://stellarium.org/', use: 'Deep-sky objects and their names in the sky catalog.' },
			{ name: 'SIMBAD', owner: 'CDS, Strasbourg, France', url: 'https://simbad.cds.unistra.fr/simbad/', use: 'Star clusters of the sky catalog.' },
			{ name: 'Bennett and Dunlop catalogs', owner: 'docdb.net', url: 'https://www.docdb.net/', use: 'Designations of the sky catalog.' },
			{ name: 'Herschel 400', owner: 'Go Astronomy', url: 'https://www.go-astronomy.com/herschel-objects.htm', use: 'Designations of the sky catalog.' },
			{ name: 'Gum catalog', owner: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Gum_catalog', use: 'Designations of the sky catalog.' },
			{ name: 'CGI Moon Kit', owner: "NASA's Scientific Visualization Studio", url: 'https://svs.gsfc.nasa.gov/4720/', use: 'Color maps of the Moon Inspector.' },
			{ name: 'Gazetteer of Planetary Nomenclature', owner: 'USGS Astrogeology Science Center and the IAU', url: 'https://planetarynames.wr.usgs.gov/', use: 'Lunar surface features of the Moon Inspector.' },
			{ name: 'World location map', owner: 'TUBS, Wikimedia Commons', url: 'https://commons.wikimedia.org/wiki/File:World_location_map_(equirectangular_180).svg', use: 'Basemap of the eclipse maps.', license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' } },
		],
	},
	{
		title: 'External Programs',
		credits: [
			{ name: 'ASTAP', owner: 'Han Kleijn', url: 'https://www.hnsky.org/astap.htm', use: 'Optional plate solving and star detection, installed by you.' },
			{ name: 'Astrometry.net', url: 'https://astrometry.net/', use: 'Optional local plate solving with solve-field, installed by you.' },
		],
	},
]

// Fetch of the About page, injectable for tests.
export interface AboutIo {
	// Fetches a resource of the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
}

// Fetch of the browser.
export const browserAboutIo: AboutIo = { fetch: (input, init) => fetch(input, init) }

// Fetches the identity of the running distribution; signal aborts the request. Rejects with an ApiResponseError
// on a failed response.
export async function fetchAbout(io: AboutIo, signal?: AbortSignal) {
	return await fetchJson<AboutInfo>(io, '/api/about', { signal })
}

// Labelled identity fields of the running distribution, in display order; the value of a field the build did not
// record is undefined.
export function aboutFields(info: AboutInfo): readonly (readonly [label: string, value: string | undefined])[] {
	return [
		['Version', info.version],
		['Commit', info.commit],
		['Core commit', info.coreCommit],
		['Built', info.builtAt],
		['Runtime', info.runtime],
		['Server platform', info.platform],
	]
}

// Plain-text summary of the running distribution for bug reports, one "label: value" line per field, naming the
// fields the build did not record.
export function versionInfoText(info: AboutInfo) {
	return ['Nebulosa', ...aboutFields(info).map(([label, value]) => `${label}: ${value ?? NOT_AVAILABLE}`)].join('\n')
}
