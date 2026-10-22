import type { FocuserBacklashConfig, FocuserBacklashMode, FocuserState } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { PanelSection } from '../../shell/ContextualPanel'
import { Button } from '../../ui/Button'
import { Checkbox } from '../../ui/Checkbox'
import { NumberInput } from '../../ui/NumberInput'
import { Select } from '../../ui/Select'
import { focuserBacklashKey, focuserBacklashRuntime, loadFocuserBacklash, saveFocuserBacklash } from '../focuserBacklash'
import { Actions, Notice, Readout } from '../parts'

// Backlash compensation of a focuser: whether it is enabled, its mode and its amounts in steps, edited as a
// draft and applied at once. The server applies the saved compensation to every positioning move of the
// focuser, from any tool; a move in progress keeps the settings it started with.

// Compensation modes in display order.
const MODES: readonly FocuserBacklashMode[] = ['OVERSHOOT', 'ABSOLUTE']

// Display name of each mode.
const MODE_LABELS: Readonly<Record<FocuserBacklashMode, string>> = { OVERSHOOT: 'Overshoot', ABSOLUTE: 'Absolute' }

// Outcome of the last apply shown under the form.
type ApplyStatus = { readonly status: 'idle' | 'saving' | 'conflict' } | { readonly status: 'error'; readonly error: string }

export interface FocuserBacklashProps {
	// State of the focuser on the watched connection.
	readonly focuser: FocuserState
}

// Whether two compensations are the same.
function sameConfig(a: FocuserBacklashConfig, b: FocuserBacklashConfig) {
	return a.enabled === b.enabled && a.mode === b.mode && a.backlashIn === b.backlashIn && a.backlashOut === b.backlashOut
}

// Section with the backlash compensation of a focuser.
export function FocuserBacklash({ focuser }: FocuserBacklashProps) {
	const runtime = useSnapshot(focuserBacklashRuntime)
	const { connectionId, id } = focuser
	const key = focuserBacklashKey(connectionId, id)
	const backlash = runtime.states[key]
	const loadError = runtime.errors[key]
	const [draft, setDraft] = useState<FocuserBacklashConfig>()
	const [apply, setApply] = useState<ApplyStatus>({ status: 'idle' })

	useEffect(() => {
		setDraft(undefined)
		setApply({ status: 'idle' })
		void loadFocuserBacklash(focuserBacklashRuntime, connectionId, id)
	}, [connectionId, id])

	if (!backlash) return <PanelSection title="Backlash Compensation">{loadError ? <Notice error>{loadError}</Notice> : <Notice>Loading…</Notice>}</PanelSection>

	const saved = backlash.config
	const edited = draft ?? saved
	const dirty = !sameConfig(edited, saved)
	const supported = focuser.canAbsoluteMove
	const status = !supported ? 'Unsupported' : saved.enabled ? `Enabled (${MODE_LABELS[saved.mode]})` : 'Disabled'

	function edit(patch: Partial<FocuserBacklashConfig>) {
		setDraft({ ...edited, ...patch })
		if (apply.status !== 'saving') setApply({ status: 'idle' })
	}

	async function save() {
		setApply({ status: 'saving' })
		const result = await saveFocuserBacklash(focuserBacklashRuntime, connectionId, id, edited, backlash.revision)
		if (result.status !== 'error') setDraft(undefined)
		setApply(result.status === 'saved' ? { status: 'idle' } : result)
	}

	return (
		<PanelSection title="Backlash Compensation">
			<Readout label="Status">{status}</Readout>
			{saved.enabled && saved.mode === 'ABSOLUTE' && backlash.offset !== 0 && <Readout label="Offset">{`${backlash.offset} steps`}</Readout>}
			{!supported && <Notice>This focuser cannot move to a position, so its moves cannot be compensated.</Notice>}
			<Checkbox label="Enabled" checked={edited.enabled} disabled={apply.status === 'saving'} onChange={(enabled) => edit({ enabled })} />
			<Select label="Mode" options={MODES} value={edited.mode} format={(mode) => MODE_LABELS[mode]} disabled={apply.status === 'saving'} onChange={(mode) => edit({ mode })} />
			<div className="flex gap-2">
				<NumberInput className="min-w-0 flex-1" label="Backlash IN" value={edited.backlashIn} min={0} step={1} suffix="steps" disabled={apply.status === 'saving'} onChange={(backlashIn) => edit({ backlashIn })} />
				<NumberInput className="min-w-0 flex-1" label="Backlash OUT" value={edited.backlashOut} min={0} step={1} suffix="steps" disabled={apply.status === 'saving'} onChange={(backlashOut) => edit({ backlashOut })} />
			</div>
			<Actions>
				<Button disabled={!dirty || apply.status === 'saving'} onClick={() => void save()}>
					Apply Configuration
				</Button>
				{dirty && (
					<Button variant="secondary" disabled={apply.status === 'saving'} onClick={() => setDraft(undefined)}>
						Discard
					</Button>
				)}
			</Actions>
			{dirty && <Notice>{focuser.moving ? 'Unsaved changes. The move in progress keeps the applied settings.' : 'Unsaved changes. Moves use the applied settings.'}</Notice>}
			{apply.status === 'conflict' && <Notice error>Another tab changed these settings; the form shows them now.</Notice>}
			{apply.status === 'error' && <Notice error>{`Save failed: ${apply.error}`}</Notice>}
			{backlash.error && <Notice error>{`Invalid configuration file: ${backlash.error}. Moves are not compensated.`}</Notice>}
			{focuser.backlashEnabled && (saved.enabled ? <Notice error>{`The driver compensates the backlash itself (${focuser.backlash.value} steps), so compensated moves are refused. Turn one of them off.`}</Notice> : <Notice>{`The driver compensates the backlash itself (${focuser.backlash.value} steps).`}</Notice>)}
			<Notice>Backlash compensation is applied automatically to supported focuser positioning commands across Nebulosa.</Notice>
		</PanelSection>
	)
}
