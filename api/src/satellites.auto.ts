import type { SatelliteService } from './satellites'
import { SatelliteRefreshError } from './satellites.sync'

// Automatic downloads of the CelesTrak groups an operator turned on (SatelliteService.setAutoDownload): once when the
// server starts and then on an in-process Bun.cron schedule every 6 hours. A run goes through the groups one after the
// other and downloads only those whose fair-use interval (2 hours for GP elements) and blocks allow it now, through the
// same downloads as an operator's, so it never adds a request the usage policy forbids; a group inside its interval
// waits for a later run. A failure is recorded in the state of its source, which the Settings of the tool shows, and
// never stops the other groups or the schedule.

// Schedule of the runs: every 6 hours, at 00:00, 06:00, 12:00, and 18:00 of the server's time zone.
export const AUTO_DOWNLOAD_SCHEDULE = '0 */6 * * *'

// Scheduled job that can be stopped.
export interface AutoDownloadJob {
	// Stops the job; its callback never fires again.
	readonly stop: () => unknown
}

// Schedules a callback on a cron expression; Bun.cron by default, replaced in tests.
export type AutoDownloadScheduler = (schedule: string, run: () => Promise<void>) => AutoDownloadJob

// Collaborators of the automatic downloads, injectable in tests.
export interface SatelliteAutoDownloadOptions {
	// Scheduler of the periodic runs.
	readonly schedule?: AutoDownloadScheduler
	// Wall clock, Unix milliseconds.
	readonly now?: () => number
}

// Automatic downloads of the satellite catalog.
export class SatelliteAutoDownload implements Disposable {
	readonly #schedule: AutoDownloadScheduler
	readonly #now: () => number
	#job?: AutoDownloadJob
	#running?: Promise<void>
	#disposed = false

	// Creates the downloads of a service; nothing runs until start.
	constructor(
		private readonly service: SatelliteService,
		options: SatelliteAutoDownloadOptions = {},
	) {
		this.#schedule = options.schedule ?? ((schedule, run) => Bun.cron(schedule, run))
		this.#now = options.now ?? Date.now
	}

	// Runs once now and schedules the runs every 6 hours; does nothing when already started or released.
	start() {
		if (this.#job || this.#disposed) return
		this.#job = this.#schedule(AUTO_DOWNLOAD_SCHEDULE, () => this.run())
		void this.run()
	}

	// Downloads every group turned on whose interval allows it now, one at a time; joins the run in progress. Never
	// rejects: the scheduler would otherwise end the process.
	run(): Promise<void> {
		this.#running ??= this.#run().finally(() => (this.#running = undefined))
		return this.#running
	}

	// One run over the groups turned on.
	async #run() {
		try {
			for (const sourceKey of this.service.store.autoDownloads()) {
				if (this.#disposed) return
				// Read again before each group: a failure of the previous one may block every source.
				if (this.service.sync.nextAllowedAt(sourceKey) > this.#now()) continue

				try {
					await this.service.refresh(sourceKey)
				} catch (error) {
					if (error instanceof SatelliteRefreshError) console.warn(`The automatic download of ${sourceKey} failed: ${error.message}`)
					else throw error
				}
			}
		} catch (error) {
			console.error('The automatic satellite downloads stopped', error)
		}
	}

	// Stops the schedule; a run in progress ends after its current download.
	[Symbol.dispose]() {
		this.#disposed = true
		this.#job?.stop()
		this.#job = undefined
	}
}
