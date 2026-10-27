import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime } from '../../equipment-control/control'
import { activeProfile, profileState } from '../../profile/profile'
import type { Profile } from '../../profile/schema'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { liveSensors, sensorRuntime } from '../../sky/sensors'
import { Select } from '../../ui/Select'
import { AIRMASS_EXAMPLE, type AirmassDraft, DEW_EXAMPLE, type DewDraft } from './atmosphere'
import { AirmassCalculator, DewCalculator } from './AtmosphereCalculator'
import { CALCULATOR_IDS, CATEGORY_LABELS, type CalculatorId, calculatorDefinition } from './catalog'
import { EXPOSURE_PLAN_EXAMPLE, type ExposurePlanDraft, STAR_TRAIL_EXAMPLE, type StarTrailDraft } from './exposure'
import { ExposurePlannerCalculator, StarTrailingCalculator } from './ExposureCalculator'
import { IMAGING_SETUP_EXAMPLE, type ImagingSetupDraft, MOSAIC_EXAMPLE, type MosaicDraft } from './optics'
import { ImagingSetupCalculator, MosaicCalculator } from './OpticsCalculator'
import { DIFFRACTION_EXAMPLE, type DiffractionDraft, SAMPLING_EXAMPLE, type SamplingDraft } from './sampling'
import { DiffractionCalculator, SamplingCalculator } from './SamplingCalculator'
import type { DraftEntry, SourceContext } from './sources'
import { APERTURE_COMPARISON_EXAMPLE, type ApertureComparisonDraft, EYEPIECE_EXAMPLE, type EyepieceDraft } from './visual'
import { ApertureComparisonCalculator, EyepieceCalculator } from './VisualCalculator'

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
	readonly sampling: DraftEntry<SamplingDraft>
	readonly diffraction: DraftEntry<DiffractionDraft>
	readonly 'exposure-planner': DraftEntry<ExposurePlanDraft>
	readonly 'star-trailing': DraftEntry<StarTrailDraft>
	readonly eyepiece: DraftEntry<EyepieceDraft>
	readonly 'aperture-comparison': DraftEntry<ApertureComparisonDraft>
	readonly airmass: DraftEntry<AirmassDraft>
	readonly dew: DraftEntry<DewDraft>
}

// Drafts the tool opens with: the example of every calculator.
const INITIAL_DRAFTS: CalculatorDrafts = {
	'imaging-setup': { draft: IMAGING_SETUP_EXAMPLE },
	mosaic: { draft: MOSAIC_EXAMPLE },
	sampling: { draft: SAMPLING_EXAMPLE },
	diffraction: { draft: DIFFRACTION_EXAMPLE },
	'exposure-planner': { draft: EXPOSURE_PLAN_EXAMPLE },
	'star-trailing': { draft: STAR_TRAIL_EXAMPLE },
	eyepiece: { draft: EYEPIECE_EXAMPLE },
	'aperture-comparison': { draft: APERTURE_COMPARISON_EXAMPLE },
	airmass: { draft: AIRMASS_EXAMPLE },
	dew: { draft: DEW_EXAMPLE },
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
				{selected === 'sampling' && <SamplingCalculator {...bind('sampling')} />}
				{selected === 'diffraction' && <DiffractionCalculator {...bind('diffraction')} />}
				{selected === 'exposure-planner' && <ExposurePlannerCalculator {...bind('exposure-planner')} />}
				{selected === 'star-trailing' && <StarTrailingCalculator {...bind('star-trailing')} />}
				{selected === 'eyepiece' && <EyepieceCalculator {...bind('eyepiece')} />}
				{selected === 'aperture-comparison' && <ApertureComparisonCalculator {...bind('aperture-comparison')} />}
				{selected === 'airmass' && <AirmassCalculator {...bind('airmass')} />}
				{selected === 'dew' && <DewCalculator {...bind('dew')} />}
			</div>
		</div>
	)
}
