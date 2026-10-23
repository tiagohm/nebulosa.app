import { jobStatus, submissionStatus, upload, wcsFile } from 'nebulosa/src/astrometry/solvers/astrometrynet'
import { type FitsHeader, readFits } from 'nebulosa/src/io/formats/fits/fits'
import { bufferSource } from 'nebulosa/src/io/io'
import type { ResolvedPlateSolveHints } from './platesolving.hints'

// Plate solving on the nova.astrometry.net web service, driven step by step with the toolkit's requests so every
// step is observable: one upload of the scientific FITS copy (a submission id), the wait for the job the service
// creates for it (a job id), the polling of that job, and the download of its WCS. The image is uploaded once and
// never again, whatever fails afterwards; polling waits pollInterval between rounds and gives up after
// MAX_NETWORK_FAILURES failed requests in a row. The whole solve is bounded by its timeout. Cancelling only stops
// following the remote job: the service is not asked to stop it. The submission is private, without permission
// for commercial use or modification, which does not mean the service keeps no copy.

// Requests in a row that may fail (no answer, or an answer that is not OK) before polling gives up.
export const MAX_NETWORK_FAILURES = 3

// Default wait between two polls, in milliseconds.
export const NOVA_POLL_INTERVAL = 5000

// Step a nova solve reached: uploading the image, waiting for the job of the submission, solving, or downloading
// the WCS.
export type NovaStage = 'uploading' | 'submitted' | 'solving' | 'retrieving'

// Progress of a nova solve: its step and the remote ids known so far.
export interface NovaProgress {
	// Step reached.
	readonly stage: NovaStage
	// Id of the submission, once uploaded.
	readonly submissionId?: number
	// Id of the job, once the service created it.
	readonly jobId?: number
}

// Why a nova solve did not end with a WCS or a failed job:
// - sessionExpired: the service refused the saved session; signing in again is needed.
// - rejected: the service refused the upload for another reason.
// - network: the service could not be reached, or answered errors too many times in a row.
// - timeout: the solve did not end within its timeout.
// - cancelled: the caller stopped following the remote job.
// - invalidWcs: the downloaded WCS is not a readable FITS header.
export type NovaErrorCode = 'sessionExpired' | 'rejected' | 'network' | 'timeout' | 'cancelled' | 'invalidWcs'

// Failure of a nova solve, with its reason.
export class NovaError extends Error {
	// Creates the error of a reason.
	constructor(
		readonly code: NovaErrorCode,
		message: string,
	) {
		super(message)
	}
}

// What a nova solve uploads and how it is followed.
export interface NovaSolveOptions {
	// Base URL of the service, without a trailing slash.
	readonly apiUrl: string
	// Session token of the account.
	readonly session: string
	// FITS copy of the image.
	readonly image: Uint8Array<ArrayBuffer>
	// Hints sent with the upload.
	readonly hints: ResolvedPlateSolveHints
	// Fractional tolerance of the scale hint, in (0, 1).
	readonly scaleTolerance: number
	// Downsampling factor the service applies before detecting stars, at least 1.
	readonly downsample: number
	// Limit of the whole solve, in milliseconds.
	readonly timeout: number
	// Wait between two polls, in milliseconds.
	readonly pollInterval: number
	// Stops following the remote job.
	readonly signal: AbortSignal
	// Receives every step reached.
	readonly progress: (progress: NovaProgress) => void
}

// Uploads an image to nova and follows its job to the end. Resolves to the header of the solved WCS, or undefined
// when the job failed (the service found no solution). Throws NovaError.
export async function novaSolve({ apiUrl, session, image, hints, scaleTolerance, downsample, timeout, pollInterval, signal, progress }: NovaSolveOptions): Promise<FitsHeader | undefined> {
	const deadline = AbortSignal.timeout(timeout)
	const wait = AbortSignal.any([deadline, signal])
	let failures = 0

	// Throws when the solve was cancelled or timed out.
	const stopped = () => {
		if (signal.aborted) throw new NovaError('cancelled', 'The plate solve was cancelled; the remote job was not stopped')
		if (deadline.aborted) throw new NovaError('timeout', `The service did not solve the image within ${timeout / 1000} s`)
	}

	// Runs a request of the service, counting a failed one; returns undefined for a failure that may be retried.
	const attempt = async <T>(request: () => Promise<T | undefined>): Promise<T | undefined> => {
		try {
			const response = await request()
			if (response !== undefined) failures = 0
			else if (++failures >= MAX_NETWORK_FAILURES) throw new NovaError('network', 'The service answered errors too many times in a row')
			return response
		} catch (error) {
			if (error instanceof NovaError) throw error
			stopped()
			if (++failures >= MAX_NETWORK_FAILURES) throw new NovaError('network', 'Unable to reach the service')
			return undefined
		}
	}

	// Waits between two polls, or less when the solve is cancelled or times out meanwhile, then throws if it was.
	const pause = async () => {
		if (!wait.aborted) {
			const { promise, resolve } = Promise.withResolvers<void>()
			const timer = setTimeout(resolve, pollInterval)
			wait.addEventListener('abort', () => resolve(), { once: true })
			await promise
			clearTimeout(timer)
		}

		stopped()
	}

	progress({ stage: 'uploading' })

	const scale = hints.scale?.value
	const submission = await attempt(() =>
		upload(
			{
				input: new Blob([image]),
				apiUrl,
				session,
				downsample,
				...(hints.rightAscension && hints.declination && { rightAscension: hints.rightAscension.value, declination: hints.declination.value }),
				...(hints.radius && { radius: hints.radius.value }),
				...(scale !== undefined && { scaleUnits: 'arcsecperpix' as const, scaleLower: scale * (1 - scaleTolerance), scaleUpper: scale * (1 + scaleTolerance) }),
			},
			wait,
		),
	)

	// An upload is never sent again: without a submission the solve ends here.
	if (!submission) throw new NovaError('network', 'The service did not accept the upload')
	if (submission.status !== 'success' || submission.subid === undefined) {
		const message = submission.errormessage || 'The service refused the upload'
		throw new NovaError(/session/i.test(message) ? 'sessionExpired' : 'rejected', message)
	}

	const submissionId = submission.subid
	progress({ stage: 'submitted', submissionId })

	let jobId: number | undefined

	while (jobId === undefined) {
		await pause()
		const status = await attempt(() => submissionStatus(submissionId, { apiUrl, session }, wait))
		jobId = status?.jobs.find((id) => typeof id === 'number') ?? undefined
	}

	progress({ stage: 'solving', submissionId, jobId })

	while (true) {
		await pause()
		const job = await attempt(() => jobStatus(jobId, { apiUrl, session }, wait))
		if (job?.status === 'failure') return undefined
		if (job?.status === 'success') break
	}

	progress({ stage: 'retrieving', submissionId, jobId })

	let blob: Blob | undefined

	while (!blob) {
		blob = await attempt(() => wcsFile(jobId, { apiUrl, session }, wait))
		if (!blob) await pause()
	}

	try {
		const header = (await readFits(bufferSource(Buffer.from(await blob.arrayBuffer()))))?.hdus[0]?.header
		if (header) return header
	} catch {
		// Reported below.
	}

	throw new NovaError('invalidWcs', 'The WCS of the service is not a readable FITS header')
}
