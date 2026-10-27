import { cn } from 'cn'
import { type ReactNode, useState } from 'react'
import type { OpticalConfiguration } from '../../sky/framing'
import { Button } from '../../ui/Button'
import { Field, InputSuffix, inputClassName, suffixPadding } from '../../ui/Field'
import { Select } from '../../ui/Select'
import { type DraftEntry, importOptics, isOriginCurrent, type OpticsSourceId, opticsSources, type SourceContext, sourceGroup, sourceLabel } from './sources'
import { differs, type OptionalOutcome, type Outcome, outcomeMessage } from './values'

// Building blocks of the calculator views: the two-column layout (inputs, then results and the model's notes), the
// number field that keeps the text as typed, the rendering of an outcome, and the bar that tells where a draft's values
// come from and imports an optical configuration into it. They never write the profile or reach a device.

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
		<section className="flex min-w-0 flex-col gap-3 rounded-sm border border-line-100 bg-base-100 p-4">
			<h2 className="m-0 text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase">{title}</h2>
			{children}
		</section>
	)
}

// Layout of a calculator: the source bar and inputs, then the results and the model's notes; side by side on wide
// screens, stacked on narrow ones.
export function CalculatorLayout({ bar, inputs, results, notes }: { readonly bar: ReactNode; readonly inputs: ReactNode; readonly results: ReactNode; readonly notes: ReactNode }) {
	return (
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
	)
}

// Grid of input fields, two per row when there is room.
export function FieldGrid({ children }: { readonly children: ReactNode }) {
	return <div className="grid gap-3 sm:grid-cols-2">{children}</div>
}

// Props of a number field.
export interface NumberFieldProps {
	// Label of the field, also its title.
	readonly label: string
	// Text of the field, as typed.
	readonly value: string
	// Called with the text on every keystroke.
	readonly onChange: (value: string) => void
	// Unit drawn inside the right end of the field, such as "mm".
	readonly suffix?: string
	// Whether the field may be left empty, said in its placeholder.
	readonly optional?: boolean
}

// Number field that keeps the text as typed, so an empty or partial entry stays as it is and the calculation reads it
// as missing or invalid instead of keeping a previous number.
export function NumberField({ label, value, onChange, suffix, optional }: NumberFieldProps) {
	return (
		<Field label={label}>
			<div className="relative flex">
				<input
					type="text"
					inputMode="decimal"
					autoComplete="off"
					spellCheck={false}
					title={label}
					value={value}
					placeholder={optional ? 'Optional' : undefined}
					onChange={(e) => onChange(e.target.value)}
					style={suffix ? { paddingRight: suffixPadding(suffix) } : undefined}
					className={cn(inputClassName, 'tabular-nums')}
				/>
				{suffix && <InputSuffix>{suffix}</InputSuffix>}
			</div>
		</Field>
	)
}

// Muted explanation; in the danger color when it tells why an input cannot be used.
export function Note({ children, danger }: { readonly children: ReactNode; readonly danger?: boolean }) {
	return <p className={cn('m-0 text-xs leading-4', danger ? 'text-danger' : 'text-ink-300')}>{children}</p>
}

// Principal result, shown large.
export function Primary({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="text-xs text-ink-300">{label}</span>
			<span className="font-mono text-2xl leading-8 wrap-break-word text-ink-100">{children}</span>
		</div>
	)
}

// Label and value of a secondary result.
export function Datum({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3 text-[13px] leading-5">
			<span className="flex-none text-ink-300">{label}</span>
			<span className="min-w-0 text-right font-mono text-ink-100">{children}</span>
		</div>
	)
}

// Results of an outcome: rendered by children when ready, otherwise the explanation of what is missing or wrong.
export function OutcomeView<T>({ outcome, children }: { readonly outcome: Outcome<T>; readonly children: (value: T) => ReactNode }) {
	if (outcome.status === 'ready') return <div className="flex flex-col gap-2">{children(outcome.value)}</div>
	return <Note danger={outcome.status === 'invalid'}>{outcomeMessage(outcome)}</Note>
}

// Secondary result that depends on optional fields: hint while they are empty, then the value or why it is missing.
export function OptionalDatum<T>({ label, outcome, hint, children }: { readonly label: string; readonly outcome: OptionalOutcome<T>; readonly hint?: string; readonly children: (value: T) => ReactNode }) {
	if (outcome?.status === 'ready') return <Datum label={label}>{children(outcome.value)}</Datum>
	const message = outcome ? outcomeMessage(outcome) : hint
	if (!message) return null

	return (
		<Datum label={label}>
			<span className={cn('font-sans text-xs', outcome?.status === 'invalid' ? 'text-danger' : 'text-ink-300')}>{message}</span>
		</Datum>
	)
}

// Collapsible notes on a model: its equation, parameters, valid domain, and approximations.
export function FormulaNotes({ children }: { readonly children: ReactNode }) {
	return (
		<details className="rounded-sm border border-line-100 bg-base-100">
			<summary className="cursor-pointer px-4 py-3 text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase select-none hover:text-ink-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent">Formula & assumptions</summary>
			<div className="flex flex-col gap-2 border-t border-line-100 px-4 py-3 text-[13px] leading-5 text-ink-200">{children}</div>
		</details>
	)
}

// Equation of a model, in monospace.
export function Formula({ children }: { readonly children: ReactNode }) {
	return <code className="block font-mono text-[13px] whitespace-pre-wrap text-ink-100">{children}</code>
}

// Props of the draft bar.
export interface DraftBarProps<D> extends CalculatorViewProps<D> {
	// Values the draft starts with and is reset to, labeled as an example.
	readonly example: D
	// Fields of the draft an optical configuration fills; absent for a calculator that imports nothing.
	readonly fromOptics?: (optics: Readonly<OpticalConfiguration>) => Partial<D>
}

// Bar above the inputs: where the values come from (the example, an import, edited since, or entered by hand), the
// import of an optical configuration from a source, and the reset to the example.
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
		const result = importOptics(context, source)
		if ('reason' in result) return
		const draft = { ...entry.draft, ...fromOptics(result.optics) }
		onChange({ draft, origin: result.origin, imported: draft })
	}

	const status = origin
		? `Imported from ${origin.label}${edited ? ' · edited' : ''}. Later changes of the source are not followed.`
		: entry.origin
			? `Imported from the ${entry.origin.label}, which now follows another camera or none: import again to refresh.`
			: differs(entry.draft, example)
				? 'Values entered here.'
				: fromOptics
					? 'Example values, not your equipment: replace them or import your own.'
					: 'Example values: replace them with yours.'

	return (
		<Card title="Values">
			<Note>{status}</Note>
			{fromOptics && (
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
			)}
			{fromOptics && context.settings.presets.length === 0 && <Note>No optical presets yet: they are created in Sky → Framing.</Note>}
			<div>
				<Button variant="ghost" disabled={!differs(entry.draft, example) && !entry.origin} onClick={() => onChange({ draft: example })}>
					Reset to example
				</Button>
			</div>
		</Card>
	)
}
