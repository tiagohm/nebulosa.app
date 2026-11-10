import { useSnapshot } from 'valtio'
import { formatDateTime } from '../../format'
import { Actions } from '../../ui/Actions'
import { Button } from '../../ui/Button'
import { DataList, DataRow } from '../../ui/DataRow'
import { Modal } from '../../ui/Modal'
import { Notice } from '../../ui/Notice'
import { meteorShowerSourcesState, refreshIauCatalog } from './meteorshowers.sources'

// Sources of the Meteor Showers tool: the IAU catalog in use (bundled or downloaded, its version, checksum, counts, and the
// outcome of the last refresh) with Update Catalog, which downloads the official document again and keeps the catalog in
// use when anything fails, and the curated visual data with its editions. Nothing refreshes by itself.

// Why a refresh failed, by its code.
const FAILURE_LABELS: Readonly<Record<string, string>> = {
	upstreamUnavailable: 'The IAU Meteor Data Center could not be reached.',
	invalidCatalog: 'The document downloaded is not a valid stream catalog.',
	catalogTooLarge: 'The document downloaded is larger than allowed.',
	persistenceFailure: 'The catalog could not be saved.',
}

// Sources modal.
export function MeteorSourcesModal({ open, onClose, timeZone }: { readonly open: boolean; readonly onClose: () => void; readonly timeZone: string }) {
	const state = useSnapshot(meteorShowerSourcesState)
	const iau = state.sources?.iau
	const visual = state.sources?.visual

	return (
		<Modal open={open} onClose={onClose} title="Meteor Shower Sources">
			<div className="flex flex-col gap-3">
				<section className="flex flex-col gap-1">
					<h3 className="m-0 text-sm font-semibold text-ink-100">IAU Meteor Data Center</h3>
					{iau ? (
						<DataList>
							<DataRow label="In use">{iau.origin === 'bundled' ? 'Bundled with the application' : 'Downloaded'}</DataRow>
							<DataRow label="Version">{iau.version}</DataRow>
							{iau.retrievedAt !== undefined && <DataRow label="Downloaded">{formatDateTime(iau.retrievedAt, timeZone, false)}</DataRow>}
							<DataRow label="Showers">{`${iau.recordCount} records, ${iau.solutionCount} solutions`}</DataRow>
							<DataRow label="SHA-256">
								<span className="font-mono text-xs break-all">{iau.sha256}</span>
							</DataRow>
							{iau.lastFailureAt !== undefined && iau.lastErrorCode && <DataRow label="Last refresh failed">{`${formatDateTime(iau.lastFailureAt, timeZone, false)}: ${FAILURE_LABELS[iau.lastErrorCode] ?? iau.lastErrorCode}`}</DataRow>}
						</DataList>
					) : (
						<Notice>Reading the sources…</Notice>
					)}
					{state.error && <Notice error>{state.error}</Notice>}
					<Actions>
						<Button disabled={state.refreshing || iau?.refreshing} onClick={() => void refreshIauCatalog(meteorShowerSourcesState)}>
							{state.refreshing ? 'Updating…' : 'Update Catalog'}
						</Button>
					</Actions>
					<Notice>Downloads the official stream catalog again. A document that cannot be validated never replaces the one in use.</Notice>
				</section>
				<section className="flex flex-col gap-1">
					<h3 className="m-0 text-sm font-semibold text-ink-100">Visual Data</h3>
					{visual && (
						<>
							<Notice>{`${visual.showerCount} major showers curated by hand, revision ${visual.revision}; year-specific notes curated for ${visual.annualPredictionYears.join(' and ')}.`}</Notice>
							<ul className="m-0 list-disc pl-4 text-xs text-ink-300">
								{visual.sources.map((source) => (
									<li key={source.id}>
										<a className="text-accent" href={source.url} target="_blank" rel="noreferrer">
											{`${source.publisher}, ${source.title}`}
										</a>
									</li>
								))}
							</ul>
							<Notice>Used with credit as the IMO allows; this is a small subset, not the full Working List, and implies no endorsement.</Notice>
						</>
					)}
				</section>
			</div>
		</Modal>
	)
}
