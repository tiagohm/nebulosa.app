import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { CollapsibleSection } from '../../shell/CollapsibleSection'
import { Button } from '../../ui/Button'
import { Notice } from '../../ui/Notice'
import { isNumberText, parseNumberText } from '../../ui/numberinput.step'
import { StatusBadge, type StatusTone } from '../../ui/StatusBadge'
import { TextInput } from '../../ui/TextInput'
import { inputInstant, localInput } from '../planetary/planetary'
import { type JupiterGrsState, jupiterGrsState, keepTheirGrs, saveJupiterGrs, saveMineGrs } from './jupiter'

// Editor of the server's Great Red Spot model: the System II longitude at a reference instant and its drift, in degrees,
// with where they came from. The values are the operator's, from an observer bulletin; nothing is fetched or defaulted:
// without a saved model every field is empty, and Save Model stays disabled, with what is missing as its tooltip, until
// the longitude, the instant it was measured, and the drift are entered. The numbers are text fields with the decimal
// keypad, read as NumberInput reads them, so an empty field stays empty instead of showing a zero.
// A save from an outdated revision shows what the other tab saved and lets the operator keep it or save over it.

// Degrees per radian.
const DEGREES = 180 / Math.PI

// Label and tone of each quality of the model.
const QUALITY_LABELS = { unconfigured: { label: 'Not set', tone: 'muted' }, current: { label: 'Current', tone: 'success' }, stale: { label: 'Stale', tone: 'warning' } } as const satisfies Record<string, { readonly label: string; readonly tone: StatusTone }>

export interface GrsSettingsProps {
	// IANA zone the reference instant is entered in.
	readonly timeZone: string
}

// Editor of the Great Red Spot model.
export function GrsSettings({ timeZone }: GrsSettingsProps) {
	const grs = useSnapshot(jupiterGrsState) as JupiterGrsState
	const model = grs.grs?.model
	// Text of the longitude and of the drift as typed, in degrees and degrees per day; empty until entered.
	const [longitudeText, setLongitudeText] = useState('')
	const [reference, setReference] = useState('')
	const [driftText, setDriftText] = useState('')
	const [sourceLabel, setSourceLabel] = useState('')
	const [notes, setNotes] = useState('')

	// The form shows the saved model whenever a new revision arrives, and stays empty without one.
	useEffect(() => {
		setLongitudeText(model ? String(Number((model.longitude * DEGREES).toFixed(2))) : '')
		setReference(model ? localInput(model.referenceTime, timeZone) : '')
		setDriftText(model ? String(Number((model.drift * DEGREES).toFixed(4))) : '')
		setSourceLabel(model?.sourceLabel ?? '')
		setNotes(model?.notes ?? '')
	}, [grs.grs?.revision, timeZone])

	const longitude = parseNumberText(longitudeText)
	const drift = parseNumberText(driftText)
	const referenceTime = inputInstant(reference, timeZone)
	const skipped = reference !== '' && referenceTime === undefined
	const missing = [longitude === undefined && 'the longitude', reference === '' && 'when it was measured', drift === undefined && 'the drift'].filter((e) => e !== false)
	const status = grs.grs?.status
	const quality = QUALITY_LABELS[status?.quality ?? 'unconfigured']
	const blocked = grs.conflict ? 'Resolve the conflict first' : missing.length > 0 ? `Enter ${missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}` : missing[0]}` : skipped ? 'The clocks skip the time measured' : undefined

	function save() {
		if (longitude === undefined || drift === undefined || referenceTime === undefined) return
		const normalized = ((longitude % 360) + 360) % 360
		void saveJupiterGrs(jupiterGrsState, { longitude: normalized / DEGREES, referenceTime, drift: drift / DEGREES, sourceLabel: sourceLabel.trim() || undefined, notes: notes.trim() || undefined })
	}

	return (
		<CollapsibleSection id="jupiter.grs" title="Great Red Spot" summary={quality.label} defaultOpen={false}>
			<span className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
				<StatusBadge tone={quality.tone} label={quality.label} />
				{status?.referenceAgeDays !== undefined && `reference ${Math.abs(status.referenceAgeDays).toFixed(0)} days ${status.referenceAgeDays >= 0 ? 'old' : 'ahead'}`}
			</span>
			{!model && <Notice>Enter the spot's System II longitude from a recent observer report (such as ALPO or JUPOS) to predict its transits. Everything else works without it.</Notice>}
			{status?.quality === 'stale' && <Notice>The reference is more than 60 days from now; the drift is extrapolated and the transits may be off by tens of minutes.</Notice>}
			<TextInput label="Longitude (System II, west)" suffix="°" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="From the report" value={longitudeText} onChange={(event) => isNumberText(event.target.value) && setLongitudeText(event.target.value)} />
			<TextInput label={`Measured at (${timeZone})`} type="datetime-local" value={reference} onChange={(event) => setReference(event.target.value)} />
			<TextInput label="Drift (positive westward)" suffix="°/day" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="From the report" value={driftText} onChange={(event) => isNumberText(event.target.value) && setDriftText(event.target.value)} />
			<TextInput label="Source" value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="ALPO report of …" />
			<TextInput label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
			{skipped && <Notice error>The clocks skip this time in {timeZone}.</Notice>}
			{grs.error && <Notice error>{grs.error}</Notice>}
			{grs.conflict && (
				<Notice error>
					<span className="block">Another tab saved the model (revision {grs.conflict.revision}) after you started editing.</span>
					<span className="mt-2 flex flex-wrap gap-2">
						<Button variant="secondary" onClick={() => keepTheirGrs(jupiterGrsState)}>
							Keep Theirs
						</Button>
						<Button variant="secondary" onClick={() => void saveMineGrs(jupiterGrsState)}>
							Save Mine
						</Button>
					</span>
				</Notice>
			)}
			<Button onClick={save} disabled={grs.saving || blocked !== undefined} title={blocked}>
				{grs.saving ? 'Saving…' : 'Save Model'}
			</Button>
		</CollapsibleSection>
	)
}
