import type { Sequencer } from '#/sequencer'
import type { SequencerCompilation, SequencerPlan, SequencerPreflight, SequencerPreflightGroup } from '#/sequencer.plan'
import { compile, sequencerPlanNodes } from './sequencer.compiler'
import type { SequencerCompilerOptions } from './sequencer.compiler'

// Pre-flight view of a compilation. It reads a compilation and reports it: the diagnostics that refused the
// definition, the fields observably removed from the executable plan, and the numbers the lowering already
// derived to prove the capture loop terminates. Nothing here recomputes anything the compiler decided.
//
// Durations are seconds and slot counts are exposures. Per-group numbers are per cycle, matching the plan
// they come from; the totals of the view are for the full sequence, which is `repeat` cycles. A session may
// end before the sequence completes, so the totals are upper bounds and the integration ceiling declared by
// the end condition is reported next to them rather than folded into them: which slot of which group reaches
// that ceiling is a scheduling decision, and this view recomputes nothing the compiler did not decide.

// Empty view returned for a refused definition, so a caller reading the numbers does not have to branch on
// `ok` before finding them absent.
const SEQUENCER_NO_CAPTURE = { repeat: 0, groups: [], requiredSlots: 0, slotLimit: 0, projectedIntegration: 0, roles: [] } as const

// Number of complete passes the capture loop of a plan performs. A plan always has exactly one capture
// loop, and a plan with none captures nothing.
function repeatOf(plan: SequencerPlan) {
	for (const node of sequencerPlanNodes(plan.root)) {
		if (node.kind === 'loop') return node.repeat
	}

	return 0
}

// Projects a compilation into the pre-flight view.
//
// A refused compilation carries its diagnostics and no numbers; an accepted one carries its removals, the
// per-cycle numbers of every group, and the session totals scaled by the cycle count. Neither the
// compilation nor the plan is mutated.
export function preflight(compilation: SequencerCompilation): SequencerPreflight {
	if (!compilation.ok) return { ok: false, diagnostics: compilation.diagnostics, removals: [], ...SEQUENCER_NO_CAPTURE }

	const { plan, removals } = compilation
	const repeat = repeatOf(plan)
	const groups: SequencerPreflightGroup[] = []

	let requiredSlots = 0
	let slotLimit = 0
	let projectedIntegration = 0

	for (const group of plan.groups) {
		groups.push({ id: group.id, name: group.name, frameType: group.frameType, exposureTime: group.exposureTime, requiredSlots: group.requiredSlots, abandonmentBudget: group.abandonmentBudget, slotLimit: group.slotLimit, projectedIntegration: group.projectedIntegration })
		requiredSlots += group.requiredSlots
		slotLimit += group.slotLimit
		projectedIntegration += group.projectedIntegration
	}

	const { end } = plan.execution

	return { ok: true, diagnostics: [], removals, repeat, groups, requiredSlots: requiredSlots * repeat, slotLimit: slotLimit * repeat, projectedIntegration: projectedIntegration * repeat, integrationLimit: end.type === 'integrationTime' ? end.time : undefined, roles: plan.roles }
}

// Compiles a definition and returns only its pre-flight view, which is what an editor asks for while the
// operator types: it creates no session, reserves no device, and touches no store.
//
// Passing a registry additionally validates every action node against the handler that would execute it, so
// a definition can be checked against the handlers of a session before one exists.
export function validate(definition: Sequencer, options?: SequencerCompilerOptions): SequencerPreflight {
	return preflight(compile(definition, options))
}
