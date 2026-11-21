import { cn } from 'cn'
import { createContext, type KeyboardEvent, type ReactNode, useContext, useId, useState } from 'react'
import type { OpticalConfiguration } from '../../framing/geometry'
import { Button } from '../../ui/Button'
import { DataRow } from '../../ui/DataRow'
import { DisclosureSummary } from '../../ui/DisclosureSummary'
import { Field, InputSuffix, suffixPadding } from '../../ui/Field'
import { Notice } from '../../ui/Notice'
import { StepperFrame, stepperInputClassName } from '../../ui/NumberInput'
import { isNumberText } from '../../ui/numberinput.step'
import { SectionHeading } from '../../ui/SectionHeading'
import { Select } from '../../ui/Select'
import { type DraftEntry, importDraft, importOptics, isOriginCurrent, type OpticsSourceId, opticsSources, type SourceContext, sourceGroup, sourceLabel } from './sources'
import { differs, type FieldIssue, type OptionalOutcome, type Outcome, outcomeMessage, stepText } from './values'

// Building blocks of the calculator views: the two-column layout (inputs, then results and the model's notes) with the
// summary of the result kept in sight on narrow screens, the number field that keeps the text as typed and shows why it
// cannot be used, the rendering of an outcome, and the bar that tells where a draft's values come from and imports an
// optical configuration into it. They never write the profile or reach a device.

// Issues of the fields of the calculator shown, which its number fields read to mark themselves.
const FieldIssuesContext = createContext<readonly FieldIssue[]>([])

// Props of a calculator view.
export interface CalculatorViewProps<D> {
	// Draft of the calculator.
	readonly entry: DraftEntry<D>
	// Called with the new draft on every edit, import, or reset.
	readonly onChange: (entry: DraftEntry<D>) => void
	// What an import reads.
	readonly context: SourceContext
}

// Bordered block with a heading.
export function Card({ title, children }: { readonly title: string; readonly children: ReactNode }) {
	return (
		<section className="flex min-w-0 flex-col gap-3 rounded-md border border-line-100 bg-base-100 p-4">
			<SectionHeading as="h2">{title}</SectionHeading>
			{children}
		</section>
	)
}

// Props of the layout of a calculator.
export interface CalculatorLayoutProps {
	// Bar above the inputs: where the values come from.
	readonly bar: ReactNode
	// Fields of the calculator.
	readonly inputs: ReactNode
	// Results, or why there are none.
	readonly results: ReactNode
	// Notes on the model.
	readonly notes: ReactNode
	// Principal result, or why there is none, kept at the bottom of the screen while the inputs are edited on a narrow
	// screen, where the results come after the inputs.
	readonly summary: ReactNode
	// Why each field that cannot be used cannot be, shown under the field.
	readonly issues: readonly FieldIssue[]
}

// Layout of a calculator: the source bar and inputs, then the results and the model's notes; side by side on wide
// screens, stacked on narrow ones with the summary pinned under them.
export function CalculatorLayout({ bar, inputs, results, notes, summary, issues }: CalculatorLayoutProps) {
	return (
		<FieldIssuesContext value={issues}>
			<div className="grid items-start gap-4 md:grid-cols-2">
				<div className="flex min-w-0 flex-col gap-4">
					{bar}
					<Card title="Inputs">{inputs}</Card>
				</div>
				<div className="flex min-w-0 flex-col gap-4">
					<Card title="Results">{results}</Card>
					{notes}
				</div>
			</div>
			<div className="sticky bottom-0 z-1 -mx-4 -mb-4 border-t border-line-100 bg-base-100 px-4 py-2.5 md:hidden">{summary}</div>
		</FieldIssuesContext>
	)
}

// Grid of input fields, two per row when there is room for the step buttons and the number of each: from sm while the
// inputs span the tool, one per row from md, where they share it with the results, and two again from lg.
export function FieldGrid({ children }: { readonly children: ReactNode }) {
	return <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">{children}</div>
}

// Props of a number field.
export interface NumberFieldProps {
	// Label of the field.
	readonly label: string
	// Name the calculation gives the field in its messages, when it differs from the label; the label otherwise.
	readonly field?: string
	// Text of the field, as typed.
	readonly value: string
	// Called with the text on every keystroke or step.
	readonly onChange: (value: string) => void
	// Unit drawn inside the right end of the field, such as "mm".
	readonly suffix?: string
	// Whether the field may be left empty, said in its placeholder.
	readonly optional?: boolean
	// Whether the value may be negative, such as a declination or a temperature: the field then opens the full keyboard,
	// since the decimal keypad of phones has no minus sign.
	readonly signed?: boolean
}

// Number field that keeps the text as typed, so an empty or partial entry stays as it is and the calculation reads it
// as missing or invalid instead of keeping a previous number. It has the frame of NumberInput: the − and + buttons, like
// Arrow Up and Down, step its last typed decimal (by ten with Shift on the keys), and are disabled while there is no
// number to step; keystrokes that cannot be part of a number are refused. A field the calculation cannot use is drawn
// in the danger colour with the reason under it.
export function NumberField({ label, field = label, value, onChange, suffix, optional, signed }: NumberFieldProps) {
	const id = useId()
	const issue = useContext(FieldIssuesContext).find((e) => e.field === field)
	const down = stepText(value, -1)
	const up = stepText(value, 1)

	// Steps the value with the arrow keys.
	function step(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
		const next = stepText(value, event.key === 'ArrowUp' ? 1 : -1, event.shiftKey)
		if (next === undefined) return
		event.preventDefault()
		onChange(next)
	}

	return (
		<Field label={label} htmlFor={id}>
			<StepperFrame decreaseDisabled={down === undefined} increaseDisabled={up === undefined} onDecrease={() => down !== undefined && onChange(down)} onIncrease={() => up !== undefined && onChange(up)}>
				<input
					id={id}
					type="text"
					inputMode={signed ? 'text' : 'decimal'}
					value={value}
					placeholder={optional ? 'Optional' : undefined}
					onChange={(e) => isNumberText(e.target.value) && onChange(e.target.value)}
					onKeyDown={step}
					style={suffix ? { paddingRight: suffixPadding(suffix) } : undefined}
					className={cn(stepperInputClassName, issue && 'border-danger hover:border-danger')}
				/>
				{suffix && <InputSuffix>{suffix}</InputSuffix>}
			</StepperFrame>
			{issue && <Notice error>{issue.reason}</Notice>}
		</Field>
	)
}

// Principal result, shown as the readout of the tool, announced when it changes.
export function Primary({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="text-xs text-ink-300">{label}</span>
			<output className="block text-3xl leading-9 font-semibold tracking-[-0.01em] wrap-break-word text-ink-100 tabular-nums">{children}</output>
		</div>
	)
}

// Label and value of the summary of a result.
export interface SummaryValue {
	// Name of the result, as its readout names it.
	readonly label: string
	// The result with its unit.
	readonly value: ReactNode
}

// Summary of an outcome on one line: the principal result when ready, or what is missing or wrong. When ready, children
// returns the result to show, or undefined when its optional fields are empty, which then says nothing.
export function Summary<T>({ outcome, children }: { readonly outcome: Outcome<T>; readonly children: (value: T) => SummaryValue | undefined }) {
	if (outcome.status !== 'ready') return <Notice error={outcome.status === 'invalid'}>{outcomeMessage(outcome)}</Notice>
	const shown = children(outcome.value)
	if (!shown) return <Notice>Enter the optional fields for a result.</Notice>

	return (
		<div className="flex flex-wrap items-baseline justify-between gap-x-3">
			<span className="text-xs text-ink-300">{shown.label}</span>
			<span className="ml-auto text-base leading-6 font-semibold text-ink-100 tabular-nums">{shown.value}</span>
		</div>
	)
}

// Results of an outcome: rendered by children when ready, otherwise the explanation of what is missing or wrong.
export function OutcomeView<T>({ outcome, children }: { readonly outcome: Outcome<T>; readonly children: (value: T) => ReactNode }) {
	if (outcome.status === 'ready') return <div className="flex flex-col gap-2">{children(outcome.value)}</div>
	return <Notice error={outcome.status === 'invalid'}>{outcomeMessage(outcome)}</Notice>
}

// Secondary result that depends on optional fields: hint while they are empty, then the value or why it is missing.
export function OptionalDatum<T>({ label, outcome, hint, children }: { readonly label: string; readonly outcome: OptionalOutcome<T>; readonly hint?: string; readonly children: (value: T) => ReactNode }) {
	if (outcome?.status === 'ready') return <DataRow label={label}>{children(outcome.value)}</DataRow>
	const message = outcome ? outcomeMessage(outcome) : hint
	if (!message) return null

	return (
		<DataRow label={label}>
			<span className={cn('text-xs', outcome?.status === 'invalid' ? 'text-danger' : 'text-ink-300')}>{message}</span>
		</DataRow>
	)
}

// Collapsible notes on a model: its equation, parameters, valid domain, and approximations.
export function FormulaNotes({ children }: { readonly children: ReactNode }) {
	return (
		<details className="rounded-md border border-line-100 bg-base-100">
			<DisclosureSummary title="Formula & assumptions" className="px-4" />
			<div className="flex flex-col gap-2 border-t border-line-100 px-4 py-3 text-sm leading-5 text-pretty text-ink-200">{children}</div>
		</details>
	)
}

// Equation of a model, in monospace.
export function Formula({ children }: { readonly children: ReactNode }) {
	return <code className="block font-mono text-sm whitespace-pre-wrap text-ink-100">{children}</code>
}

// Props of the draft bar.
export interface DraftBarProps<D> extends CalculatorViewProps<D> {
	// Values the draft starts with and is reset to, labeled as an example.
	readonly example: D
	// Fields of the draft an optical configuration fills; absent for a calculator that imports nothing.
	readonly fromOptics?: (optics: Readonly<OpticalConfiguration>) => Partial<D>
}

// Bar above the inputs: where the values come from (the Equipment Setup followed until the first change, the example,
// an import, edited since, or entered by hand), the import of an optical configuration from a source, and the reset to
// the example. A calculator that imports nothing gets one line instead of a card.
export function DraftBar<D extends object>({ entry, onChange, context, example, fromOptics }: DraftBarProps<D>) {
	const options = opticsSources(context.settings)
	const [chosen, setChosen] = useState<OpticsSourceId | undefined>(entry.origin?.source)
	// Source chosen in the menu; until one is, the first that can be imported.
	const source = chosen && options.includes(chosen) ? chosen : (options.find((id) => !('reason' in importOptics(context, id))) ?? options[0])
	const origin = entry.origin && isOriginCurrent(entry.origin, context) ? entry.origin : undefined
	const edited = origin && entry.imported ? differs(entry.draft, entry.imported) : false

	// Copies the configuration of the chosen source into the draft; the fields it does not fill are kept.
	function load() {
		if (!fromOptics) return
		const next = importDraft(entry.draft, context, source, fromOptics)
		if (!('reason' in next)) onChange(next)
	}

	const status =
		entry.pristine && origin
			? 'Values of your Equipment Setup: the Main Camera behind the telescope, followed until you edit, import, or reset.'
			: origin
				? `Imported from ${origin.label}${edited ? ' · edited' : ''}.${entry.partial ? ' Fields it does not give kept their values.' : ''} Later changes of the source are not followed.`
				: entry.origin
					? `Imported from the ${entry.origin.label}, which now follows another camera or none: import again to refresh.`
					: differs(entry.draft, example)
						? 'Values entered here.'
						: fromOptics
							? 'Example values, not your equipment: replace them or import your own.'
							: 'Example values: replace them with yours.'

	const reset = (
		<Button variant="ghost" disabled={!differs(entry.draft, example) && !entry.origin} onClick={() => onChange({ draft: example })}>
			Reset to example
		</Button>
	)

	if (!fromOptics) {
		return (
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<Notice>{status}</Notice>
				{reset}
			</div>
		)
	}

	return (
		<Card title="Values">
			<Notice>{status}</Notice>
			<div className="flex flex-wrap items-end gap-2">
				<Select
					label="Import from"
					className="min-w-48 flex-1"
					options={options}
					value={source}
					onChange={setChosen}
					format={(id) => sourceLabel(context.settings, id)}
					group={sourceGroup}
					disabledReason={(id) => {
						const result = importOptics(context, id)
						return 'reason' in result ? result.reason : undefined
					}}
				/>
				<Button variant="secondary" disabled={'reason' in importOptics(context, source)} onClick={load}>
					{origin?.source === source ? 'Import again' : 'Import'}
				</Button>
			</div>
			{context.settings.framings.length === 0 && <Notice>No framing yet: framings are created in the Framing tool.</Notice>}
			<div>{reset}</div>
		</Card>
	)
}
