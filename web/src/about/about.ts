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

// Every external service, dataset, published model or method, and program the application uses, shown even when the server
// cannot be reached. Only what runs or ships with the application is listed: toolkit adapters and models no feature reaches
// are not. Authors and references come from the toolkit's own citations and the publisher's record. A new source adds its
// credit here.
export const CREDIT_GROUPS: readonly CreditGroup[] = [
	{
		title: 'Online Services',
		credits: [
			{ name: 'Open-Meteo', url: 'https://open-meteo.com/', use: 'Hourly weather forecast of Astro Weather.', license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, notice: 'Free tier for non-commercial use.' },
			{ name: '7Timer!', url: 'https://www.7timer.info/', use: 'Seeing and transparency forecast of Astro Weather.', notice: 'Free for non-commercial use. Ye, Q.-Z. 2011, PASP, 123, 113.' },
			{ name: 'Horizons', owner: 'NASA/JPL Solar System Dynamics', url: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html', use: 'Accurate positions of solar system bodies in the Sky, and small-body SPK kernels of the SPICE Kernel Library.' },
			{ name: 'SPICE generic kernels', owner: 'NASA/JPL Navigation and Ancillary Information Facility (NAIF)', url: 'https://naif.jpl.nasa.gov/naif/data_generic.html', use: 'DE440 planetary ephemeris downloaded by the SPICE Kernel Library.', notice: 'Park, R. S. et al. 2021, AJ, 161, 105.' },
			{ name: 'Small-Body Database', owner: 'NASA/JPL Solar System Dynamics', url: 'https://ssd-api.jpl.nasa.gov/doc/sbdb.html', use: 'Search, orbits, and details of asteroids and comets, and the 1P/Halley preset of the Orbital Mechanics Explorer.' },
			{ name: 'Close Approach Data', owner: 'NASA/JPL Solar System Dynamics', url: 'https://ssd-api.jpl.nasa.gov/doc/cad.html', use: 'Encounters listed by the Close Approaches tool.' },
			{ name: 'SkyBoT', owner: 'LTE, Observatoire de Paris / CNRS (developed by IMCCE)', url: 'https://ssp.imcce.fr/webservices/skybot/', use: 'Solar system objects in the field of Image Annotation.', notice: 'This research has made use of LTE SkyBoT VO tool.' },
			{ name: 'Solar Dynamics Observatory', owner: 'NASA', url: 'https://sdo.gsfc.nasa.gov/', use: 'Latest images of the Sun in the Sun Inspector.', notice: 'Courtesy of NASA/SDO and the AIA, EVE, and HMI science teams.' },
			{ name: 'Space Weather Prediction Center', owner: 'NOAA', url: 'https://www.swpc.noaa.gov/', use: 'Active regions of the Sun in the Sun Inspector.' },
			{ name: 'CelesTrak', owner: 'T.S. Kelso', url: 'https://celestrak.org/', use: 'Orbital elements (GP) and catalog data (SATCAT) of artificial satellites, downloaded on request under its usage policy.', notice: 'Data provided by CelesTrak (https://celestrak.org/usage-policy.php).' },
			{ name: 'Earth orientation data', owner: 'IERS, with its USNO mirror', url: 'https://www.iers.org/', use: 'UT1 and polar motion of the whole server.' },
			{
				name: 'IAU Meteor Data Center',
				owner: 'International Astronomical Union',
				url: 'https://iaumdc.astro.sk/',
				use: 'The meteor shower stream catalog, bundled and downloaded again on request.',
				notice: 'Jopek, T. J. and Kaňuchová, Z., Planetary and Space Science 143, 3 (2017); Hajduková, M. et al., A&A 671, A155 (2023); Jopek, T. J. et al., A&A 682, A159 (2024); and the other references listed at https://iaumdc.astro.sk/references.',
			},
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
			{ name: 'DE440 gravitational parameters', owner: 'NASA/JPL Navigation and Ancillary Information Facility (NAIF)', url: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc', use: 'Masses of the centers of the Orbital Mechanics Explorer.', notice: 'Park, R. S. et al. 2021, AJ, 161, 105.' },
			{ name: 'Approximate planetary elements', owner: 'E. M. Standish and J. G. Williams', url: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html', use: 'J2000 mean orbit of the Earth–Moon barycenter preset of the Orbital Mechanics Explorer.', notice: 'Orbital Ephemerides of the Sun, Moon, and Planets, 1992.' },
			{ name: 'Gum catalog', owner: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Gum_catalog', use: 'Designations of the sky catalog.' },
			{
				name: 'Meteor Shower Calendar',
				owner: 'International Meteor Organization',
				url: 'https://www.imo.net/calendar/',
				use: 'Activity periods, maxima, ZHRs, and population indices of thirteen major showers (Table 5 of the 2026 edition), and the year-specific events of the 2026 and 2027 editions.',
				notice: 'IMO Meteor Shower Calendars 2026 and 2027, edited by J. Rendtel. Used as the IMO allows (https://www.imo.net/about/using-imo-data/); a small subset, with no endorsement by the IMO implied.',
			},
			{ name: 'CGI Moon Kit', owner: "NASA's Scientific Visualization Studio", url: 'https://svs.gsfc.nasa.gov/4720/', use: 'Color maps of the Moon Inspector.' },
			{ name: 'Gazetteer of Planetary Nomenclature', owner: 'USGS Astrogeology Science Center and the IAU', url: 'https://planetarynames.wr.usgs.gov/', use: 'Lunar surface features of the Moon Inspector.' },
			{ name: 'World location map', owner: 'TUBS, Wikimedia Commons', url: 'https://commons.wikimedia.org/wiki/File:World_location_map_(equirectangular_180).svg', use: 'Basemap of the eclipse maps.', license: { name: 'CC BY-SA 3.0', url: 'https://creativecommons.org/licenses/by-sa/3.0/' } },
			{ name: 'JetBrains Mono', owner: 'The JetBrains Mono Project Authors', url: 'https://github.com/JetBrains/JetBrainsMono', use: 'Typeface of the interface, bundled with the application.', license: { name: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org/' } },
		],
	},
	{
		title: 'Models and Methods',
		credits: [
			{ name: 'VSOP87', owner: 'P. Bretagnon and G. Francou', url: 'https://ui.adsabs.harvard.edu/abs/1988A%26A...202..309B', use: 'Positions of the Sun and the planets.', notice: 'A&A 202, 309 (1988).' },
			{ name: 'VSOP2000', owner: 'X. Moisson and P. Bretagnon', url: 'https://doi.org/10.1023/A:1012279014297', use: 'Position of the Earth behind the eclipse maps.', notice: 'Celestial Mechanics and Dynamical Astronomy, 2001.' },
			{ name: 'ELP/MPP02', owner: 'J. Chapront and G. Francou', url: 'https://doi.org/10.1051/0004-6361:20030529', use: 'Position of the Moon.', notice: 'A&A 404, 735 (2003).' },
			{ name: 'Astronomical Algorithms', owner: 'Jean Meeus', url: 'https://en.wikipedia.org/wiki/Jean_Meeus', use: 'Lunar phases and apsides, eclipse series, and the position of Pluto.', notice: '2nd ed., Willmann-Bell, 1998.' },
			{ name: 'Standards of Fundamental Astronomy', owner: 'IAU SOFA Board', url: 'https://www.iausofa.org/', use: 'Time scales, precession, nutation, and reductions to the observed place.' },
			{ name: 'ERFA', owner: 'ERFA contributors', url: 'https://github.com/liberfa/erfa', use: 'The routines the toolkit ports, derived from SOFA.' },
			{ name: 'ΔT polynomials', owner: 'Fred Espenak and Jean Meeus', url: 'https://eclipse.gsfc.nasa.gov/SEhelp/deltatpoly2004.html', use: 'Difference between TT and UT1 outside the historical record.', notice: 'Five Millennium Canon of Solar Eclipses, NASA/TP-2006-214141.' },
			{ name: "Measurement of the Earth's rotation", owner: 'F. R. Stephenson, L. V. Morrison, and C. Y. Hohenkerk', url: 'https://doi.org/10.1098/rspa.2016.0404', use: 'Difference between TT and UT1 over history.', notice: 'Proc. R. Soc. A 472 (2016).' },
			{ name: 'Rotational elements', owner: 'IAU Working Group on Cartographic Coordinates and Rotational Elements', url: 'https://doi.org/10.1007/s10569-017-9805-5', use: 'Rotation of the Moon and orientation of its surface.' },
			{ name: 'Planetary magnitudes', owner: 'A. Mallama and J. L. Hilton', url: 'https://doi.org/10.1016/j.ascom.2018.08.002', use: 'Apparent magnitudes of the planets.', notice: 'Astronomy and Computing, 2018.' },
			{ name: 'H-G magnitudes', owner: 'E. Bowell et al.', url: 'https://ui.adsabs.harvard.edu/abs/1989aste.conf..524B', use: 'Magnitude of asteroids with their phase angle.', notice: 'Asteroids II, 524 (1989).' },
			{
				name: 'Meteor shower activity profiles',
				owner: 'A. V. Moorhead, A. Egal, P. G. Brown, D. E. Moser, and W. J. Cooke',
				url: 'https://arxiv.org/abs/1904.06370',
				use: 'Activity curves and modelled rates of eight major meteor showers (Table 5, the NASA Meteoroid Environment Office forecast parameters).',
				notice: 'Meteor shower forecasting in near-Earth space, 2019.',
			},
			{ name: 'Air mass formula', owner: 'F. Kasten and A. T. Young', url: 'https://doi.org/10.1364/AO.28.004735', use: 'Air mass in the Calculator.', notice: 'Applied Optics 28, 4735 (1989).' },
			{ name: 'Refraction formula', owner: 'Thorsteinn Sæmundsson', url: 'https://en.wikipedia.org/wiki/Atmospheric_refraction', use: 'Refraction in the Calculator.', notice: 'Sky & Telescope 72, 70 (1986).' },
			{ name: 'Improved Magnus approximation', owner: 'O. A. Alduchov and R. E. Eskridge', url: 'https://doi.org/10.1175/1520-0450(1996)035%3C0601:IMFAOS%3E2.0.CO;2', use: 'Frost point in the Calculator.', notice: 'Journal of Applied Meteorology 35, 601 (1996).' },
			{ name: 'Resolution limits', owner: 'William R. Dawes and Lord Rayleigh', url: "https://en.wikipedia.org/wiki/Dawes'_limit", use: 'Resolving power of a telescope in the Calculator.' },
			{ name: 'World coordinates in FITS', owner: 'E. W. Greisen and M. R. Calabretta', url: 'https://doi.org/10.1051/0004-6361:20021326', use: 'Reading and writing plate solutions.', notice: 'A&A, 2002.' },
			{ name: 'SIP distortion convention', owner: 'D. L. Shupe et al.', url: 'https://fits.gsfc.nasa.gov/registry/sip/SIP_distortion_v1_0.pdf', use: 'Distortion of plate solutions.', notice: '2005.' },
			{ name: 'TPOINT', owner: 'Patrick Wallace', url: 'https://www.tpointsw.uk/', use: 'Semi-physical terms of the mount pointing models.' },
			{ name: 'PHD2', owner: 'Open PHD Guiding', url: 'https://openphdguiding.org/', use: 'Protocol and behavior the native guiding follows.' },
			{ name: 'DARV', owner: 'Robert Vice', url: 'https://astrophotography.app/usersguide/darv.htm', use: 'Drift alignment method of the DARV camera operation.' },
			{ name: 'Universal-variable Kepler propagation', owner: 'NASA/JPL NAIF SPICE Toolkit', url: 'https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/prop2b_c.html', use: 'Two-body states of the Orbital Mechanics Explorer and of small bodies away from their epoch.' },
			{ name: 'Moffat profile', owner: 'A. F. J. Moffat', url: 'https://ui.adsabs.harvard.edu/abs/1969A%26A.....3..455M', use: 'Fits of the Star Profile Inspector.', notice: 'A&A 3, 455 (1969).' },
			{ name: 'PixInsight', owner: 'Pleiades Astrophoto', url: 'https://pixinsight.com/', use: 'Adaptive display function, arcsinh stretch, and multiscale median transform the image tools follow.' },
			{ name: 'Hough transform', owner: 'Paul V. C. Hough, R. O. Duda, and P. E. Hart', url: 'https://doi.org/10.1145/361237.361242', use: 'Streak detection and the trails of DARV.', notice: 'Communications of the ACM 15, 11 (1972).' },
			{ name: 'Levenberg-Marquardt', owner: 'K. Levenberg and D. W. Marquardt', url: 'https://doi.org/10.1137/0111030', use: 'Nonlinear fits, such as star profiles and focus curves.', notice: 'Q. Appl. Math. 2, 164 (1944), and SIAM J. 11, 431 (1963).' },
			{ name: 'Theil-Sen estimator', owner: 'Henri Theil and Pranab K. Sen', url: 'https://doi.org/10.1080/01621459.1968.10480934', use: 'Robust trend lines of Auto Focus and flat frames.', notice: 'JASA 63, 1379 (1968).' },
			{ name: 'Robust weights', owner: 'P. J. Huber, A. E. Beaton, and J. W. Tukey', url: 'https://doi.org/10.1214/aoms/1177703732', use: 'Outlier rejection of the pointing model and DARV fits.', notice: 'Ann. Math. Stat. (1964), and Technometrics 16, 147 (1974).' },
		],
	},
	{
		title: 'External Programs',
		credits: [
			{ name: 'ASTAP', owner: 'Han Kleijn', url: 'https://www.hnsky.org/astap.htm', use: 'Optional plate solving and star detection, installed by you.' },
			{ name: 'Astrometry.net', url: 'https://astrometry.net/', use: 'Optional local plate solving with solve-field, installed by you.', notice: 'Lang et al., The Astronomical Journal, 2010.' },
			{
				name: 'MediaMTX',
				owner: 'bluenviron',
				url: 'https://github.com/bluenviron/mediamtx',
				use: 'Optional media gateway of Observatory Cameras, installed by you; the WHEP reader of the browser is adapted from its reader.js.',
				license: { name: 'MIT', url: 'https://github.com/bluenviron/mediamtx/blob/main/LICENSE' },
				notice: 'Copyright (c) 2019 aler9.',
			},
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
