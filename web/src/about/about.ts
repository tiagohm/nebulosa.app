import type { AboutInfo } from 'api'
import { fetchJson } from '../http'

// Data of the About page: the identity of the running distribution fetched from the server, the official links of
// the project, and the plain-text summary copied for bug reports.

// Repository of the application.
export const APP_REPOSITORY_URL = 'https://github.com/tiagohm/nebulosa.app'

// Repository of the nebulosa.ts toolkit, the core submodule.
export const CORE_REPOSITORY_URL = 'https://github.com/tiagohm/nebulosa.ts'

// License of the application, in its repository.
export const LICENSE_URL = 'https://github.com/tiagohm/nebulosa.app/blob/main/LICENSE'

// Text shown for an identity field the running build did not record.
export const NOT_AVAILABLE = 'Not available in this build'

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
