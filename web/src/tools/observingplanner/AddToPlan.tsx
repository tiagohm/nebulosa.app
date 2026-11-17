import type { ObservingConstraints } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import type { SiteLocation } from '../../location/site'
import { Button } from '../../ui/Button'
import { Modal, ModalActions } from '../../ui/Modal'
import { Notice } from '../../ui/Notice'
import { Select } from '../../ui/Select'
import { TextInput } from '../../ui/TextInput'
import { createPlan, defaultPlanFor, editPlan, planLabel, type NamedTarget, newItem, newPlanDocument, observingPlannerState, observingPlansState, openPlan, sortedPlans } from './observingplanner'

// Dialog adding a target to a night plan: an existing plan, or a new one for the active site and the tool's night and constraints.
// It proposes the plan of the tool's night (at the tool's place first), else a new plan, and says so when the plan chosen
// is for another night. The target joins the end of the plan unscheduled, with an hour requested; nothing else of the plan changes.

export interface AddToPlanProps {
	// Target to add; the dialog is closed without one.
	readonly target?: NamedTarget
	// Closes the dialog.
	readonly onClose: () => void
	// Location of the tool, which a new plan copies; undefined without one.
	readonly location?: SiteLocation
	// Saved site the location is, which a new plan names as its origin.
	readonly siteId?: string
	// Evening of the tool, which a new plan takes.
	readonly eveningDate?: string
	// Constraints of the tool, which a new plan takes.
	readonly constraints?: ObservingConstraints
}

// Value of the plan selector that creates a plan.
const NEW_PLAN = ''

// Dialog adding a target to a night plan.
export function AddToPlan({ target, onClose, location, siteId, eveningDate, constraints }: AddToPlanProps) {
	const plans = sortedPlans(useSnapshot(observingPlansState))
	const [choice, setChoice] = useState<string>()
	const [name, setName] = useState('')
	const [error, setError] = useState<string>()
	const selected = choice ?? defaultPlanFor(plans, location, eveningDate) ?? NEW_PLAN
	const canCreate = !!location && !!eveningDate && !!constraints
	const options = [...plans.map((plan) => plan.id), NEW_PLAN]
	const chosen = selected === NEW_PLAN ? undefined : plans.find((plan) => plan.id === selected)

	// Every target opens the dialog afresh, on the plan proposed for it.
	useEffect(() => {
		setChoice(undefined)
		setName('')
		setError(undefined)
	}, [target])

	// Adds the target and opens its plan.
	async function add() {
		if (!target) return

		if (selected !== NEW_PLAN) {
			const plan = observingPlansState.plans[selected]
			editPlan(observingPlansState, selected, (document) => ({ ...document, items: [...document.items, newItem(target, plan.constraints)] }))
			openPlan(observingPlannerState, selected)
			onClose()
			return
		}

		if (!location || !eveningDate || !constraints) return
		const id = await createPlan(observingPlansState, newPlanDocument(name.trim() || `Night of ${eveningDate}`, location, siteId, eveningDate, constraints, [newItem(target, constraints)]))
		if (!id) {
			setError('The plan could not be created.')
			return
		}

		openPlan(observingPlannerState, id)
		onClose()
	}

	return (
		<Modal open={!!target} onClose={onClose} title={`Add ${target?.name ?? 'target'} to a plan`} className="max-w-md">
			<div className="flex flex-col gap-3">
				<Select
					label="Plan"
					options={options}
					value={selected}
					onChange={setChoice}
					format={(id) => {
						if (id === NEW_PLAN) return 'New plan…'
						const plan = plans.find((e) => e.id === id)
						return plan ? planLabel(plan) : id
					}}
					disabledReason={(id) => (id === NEW_PLAN && !canCreate ? 'Set the observing site of this profile first' : undefined)}
				/>
				{selected === NEW_PLAN && <TextInput label="Name" value={name} placeholder={eveningDate ? `Night of ${eveningDate}` : 'Night plan'} onChange={(event) => setName(event.target.value)} />}
				{selected === NEW_PLAN && canCreate && <Notice>The new plan copies the active site, the night of {eveningDate}, and the constraints of the tool.</Notice>}
				{chosen && eveningDate && chosen.eveningDate !== eveningDate && (
					<p className="m-0 text-xs leading-4 text-warning">
						This plan is for the night of <span className="whitespace-nowrap">{chosen.eveningDate}</span>, not <span className="whitespace-nowrap">{eveningDate}</span>: the target is judged against that night's windows and the plan's constraints.
					</p>
				)}
				{error && <Notice error>{error}</Notice>}
			</div>
			<ModalActions>
				<Button variant="secondary" onClick={onClose}>
					Cancel
				</Button>
				<Button disabled={selected === NEW_PLAN && !canCreate} onClick={() => void add()} data-autofocus>
					Add
				</Button>
			</ModalActions>
		</Modal>
	)
}
