import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime } from '../../equipment-control/control'
import { activeProfile, profileState } from '../../profile/profile'
import type { Profile } from '../../profile/schema'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { liveSensors, sensorRuntime } from '../../sky/sensors'
import { Select } from '../../ui/Select'
import { CALCULATOR_IDS, CATEGORY_LABELS, type CalculatorId, calculatorDefinition } from './catalog'
import { IMAGING_SETUP_EXAMPLE, type ImagingSetupDraft, MOSAIC_EXAMPLE, type MosaicDraft } from './optics'
import { ImagingSetupCalculator, MosaicCalculator } from './OpticsCalculator'
import type { DraftEntry, SourceContext } from './sources'

// Calculator tool: task-oriented observing and imaging calculations over the pure formulas of the toolkit, computed in
// the browser as the fields are typed. One grouped menu chooses the calculator; each keeps its own draft while the tool
// is open, so switching calculators never changes another's values. Drafts start from labeled examples, may import an
// optical configuration of the active profile by value, and are never saved: the profile, its presets, and the devices
// are only read. A change of the active profile starts over from the examples, so no draft keeps another profile's
// equipment.

// Draft of every calculator.
interface CalculatorDrafts {
	readonly 'imaging-setup': DraftEntry<ImagingSetupDraft>
	readonly mosaic: DraftEntry<MosaicDraft>
}

// Drafts the tool opens with: the example of every calculator.
const INITIAL_DRAFTS: CalculatorDrafts = {
	'imaging-setup': { draft: IMAGING_SETUP_EXAMPLE },
	mosaic: { draft: MOSAIC_EXAMPLE },
}

// Calculator tool.
export function Calculator() {
	const profile = activeProfile(useSnapshot(profileState))

	return (
		<WorkspaceLayout workspace="tools" title="Calculator">
			<CalculatorBody key={profile.id} profile={profile} />
		</WorkspaceLayout>
	)
}

// Menu, description, and view of the chosen calculator for one profile.
function CalculatorBody({ profile }: { readonly profile: Readonly<Pick<Profile, 'id' | 'settings'>> }) {
	const [selected, setSelected] = useState<CalculatorId>(CALCULATOR_IDS[0])
	const [drafts, setDrafts] = useState(INITIAL_DRAFTS)
	const sensors = useSnapshot(sensorRuntime)
	const live = liveSensors(sensors, useSnapshot(controlRuntime))
	const { telescope, guideTelescope, sky } = profile.settings
	const context: SourceContext = { profileId: profile.id, settings: { telescope, guideTelescope, presets: sky.framing?.presets ?? [], manualSensor: sky.framing?.manualSensor }, live, cameras: sensors.cameras }
	const definition = calculatorDefinition(selected)

	// Returns the draft of a calculator and the callback that replaces it.
	function bind<K extends CalculatorId>(id: K) {
		return { entry: drafts[id], onChange: (entry: CalculatorDrafts[K]) => setDrafts((current) => ({ ...current, [id]: entry })), context }
	}

	return (
		<div className="h-full overflow-y-auto bg-base-000">
			<div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
					<Select label="Calculator" className="sm:w-72 sm:flex-none" options={CALCULATOR_IDS} value={selected} onChange={setSelected} format={(id) => calculatorDefinition(id).label} group={(id) => CATEGORY_LABELS[calculatorDefinition(id).category]} />
					<p className="m-0 text-[13px] leading-5 text-ink-300 sm:pb-2">{definition.description}</p>
				</div>
				{selected === 'imaging-setup' && <ImagingSetupCalculator {...bind('imaging-setup')} />}
				{selected === 'mosaic' && <MosaicCalculator {...bind('mosaic')} />}
			</div>
		</div>
	)
}
