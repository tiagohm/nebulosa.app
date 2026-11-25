import { useState } from 'react'
import { useSnapshot } from 'valtio'
import { catalogState } from '../../equipment/catalog'
import { useProfileTelescopes } from '../../equipment/telescopes'
import type { OpticalConfiguration } from '../../framing/geometry'
import { isSetupFraming, useResolvedFramings } from '../../framing/resolve'
import { activeProfile, profileState } from '../../profile/profile'
import type { Profile } from '../../profile/schema'
import { navigate, routeState } from '../../shell/route'
import { WorkspaceLayout } from '../../shell/WorkspaceLayout'
import { sensorRuntime } from '../../sky/sensors'
import { useRoleSensors } from '../../sky/useSkyDevices'
import { Select } from '../../ui/Select'
import { AIRMASS_EXAMPLE, type AirmassDraft, DEW_EXAMPLE, type DewDraft } from './atmosphere'
import { AirmassCalculator, DewCalculator } from './AtmosphereCalculator'
import { CALCULATOR_IDS, CATEGORY_LABELS, type CalculatorId, calculatorDefinition, isCalculatorId } from './catalog'
import { EXPOSURE_PLAN_EXAMPLE, type ExposurePlanDraft, STAR_TRAIL_EXAMPLE, type StarTrailDraft, starTrailFromOptics } from './exposure'
import { ExposurePlannerCalculator, StarTrailingCalculator } from './ExposureCalculator'
import { IMAGING_SETUP_EXAMPLE, type ImagingSetupDraft, imagingSetupFromOptics, MOSAIC_EXAMPLE, type MosaicDraft, mosaicFromOptics } from './optics'
import { ImagingSetupCalculator, MosaicCalculator } from './OpticsCalculator'
import { DIFFRACTION_EXAMPLE, type DiffractionDraft, diffractionFromOptics, SAMPLING_EXAMPLE, type SamplingDraft, samplingFromOptics } from './sampling'
import { DiffractionCalculator, SamplingCalculator } from './SamplingCalculator'
import { type DraftEntry, type SourceContext, shownEntry } from './sources'
import { APERTURE_COMPARISON_EXAMPLE, type ApertureComparisonDraft, EYEPIECE_EXAMPLE, type EyepieceDraft, eyepieceFromOptics } from './visual'
import { ApertureComparisonCalculator, EyepieceCalculator } from './VisualCalculator'

// Calculator tool: task-oriented observing and imaging calculations over the pure formulas of the toolkit, computed in
// the browser as the fields are typed. One grouped menu chooses the calculator, which the URL names
// (/tools/calculator/<calculator id>), so a reload or a link reopens it; each keeps its own draft while the tool is
// open, so switching calculators never changes another's values. A calculator that imports optics shows the Main Camera
// of the Equipment Setup until its draft is first changed, when the setup fills every field it imports; otherwise its
// draft starts from a labeled example. Drafts may import an optical configuration of the active profile by value and are
// never saved: the profile, the framings, and the devices are only read. A change of the active profile starts over, so
// no draft keeps another profile's equipment.

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

// Fields of a calculator's draft.
type DraftOf<K extends CalculatorId> = CalculatorDrafts[K]['draft']

// Drafts the tool opens with: the example of every calculator, pristine, so the ones that import optics show the
// Equipment Setup when it can.
const INITIAL_DRAFTS: CalculatorDrafts = {
	'imaging-setup': { draft: IMAGING_SETUP_EXAMPLE, pristine: true },
	mosaic: { draft: MOSAIC_EXAMPLE, pristine: true },
	sampling: { draft: SAMPLING_EXAMPLE, pristine: true },
	diffraction: { draft: DIFFRACTION_EXAMPLE, pristine: true },
	'exposure-planner': { draft: EXPOSURE_PLAN_EXAMPLE, pristine: true },
	'star-trailing': { draft: STAR_TRAIL_EXAMPLE, pristine: true },
	eyepiece: { draft: EYEPIECE_EXAMPLE, pristine: true },
	'aperture-comparison': { draft: APERTURE_COMPARISON_EXAMPLE, pristine: true },
	airmass: { draft: AIRMASS_EXAMPLE, pristine: true },
	dew: { draft: DEW_EXAMPLE, pristine: true },
}

// Fields each calculator that imports optics fills from an optical configuration, the same its draft bar imports.
const FROM_OPTICS: { readonly [K in CalculatorId]?: (optics: Readonly<OpticalConfiguration>) => Partial<DraftOf<K>> } = {
	'imaging-setup': imagingSetupFromOptics,
	mosaic: mosaicFromOptics,
	sampling: samplingFromOptics,
	diffraction: diffractionFromOptics,
	'star-trailing': starTrailFromOptics,
	eyepiece: eyepieceFromOptics,
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
	const { route } = useSnapshot(routeState)
	const named = route.workspace === 'tools' ? route.calculator : undefined
	const selected = isCalculatorId(named) ? named : CALCULATOR_IDS[0]
	const [drafts, setDrafts] = useState(INITIAL_DRAFTS)
	const sensors = useSnapshot(sensorRuntime)
	const live = useRoleSensors()
	const framings = useResolvedFramings().flatMap(({ id, name, optics }) => (isSetupFraming(id) ? [] : [{ id, name, optics }]))
	const { mainTelescope, guideTelescope } = useProfileTelescopes(profile.settings)
	const { cameras: catalogCameras, telescopes: catalogTelescopes } = useSnapshot(catalogState)
	const context: SourceContext = { profileId: profile.id, settings: { mainTelescope, guideTelescope, framings, catalogCameras, catalogTelescopes }, live, cameras: sensors.cameras }
	const definition = calculatorDefinition(selected)

	// Shows a calculator, naming it in the URL.
	function select(id: CalculatorId) {
		navigate(routeState, { workspace: 'tools', tool: 'calculator', calculator: id })
	}

	// Returns the draft a calculator shows and the callback that replaces it; any change ends its pristine state.
	function bind<K extends CalculatorId>(id: K) {
		const entry = shownEntry<DraftOf<K>>(drafts[id], context, FROM_OPTICS[id])
		const onChange = ({ draft, origin, imported, partial }: DraftEntry<DraftOf<K>>) => setDrafts((current) => ({ ...current, [id]: { draft, origin, imported, partial } }))
		return { entry, onChange, context }
	}

	return (
		<div className="h-full overflow-y-auto bg-base-000">
			<div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
					<Select label="Calculator" className="sm:w-72 sm:flex-none" options={CALCULATOR_IDS} value={selected} onChange={select} format={(id) => calculatorDefinition(id).label} group={(id) => CATEGORY_LABELS[calculatorDefinition(id).category]} />
					<p className="m-0 text-sm leading-5 text-pretty text-ink-300 sm:pb-2">{definition.description}</p>
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
