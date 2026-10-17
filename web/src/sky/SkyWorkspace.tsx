import { cn } from 'cn'
import { PanelSection, PlannedControls } from '../shell/ContextualPanel'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { inputClassName } from '../ui/Field'

// Sky workspace: sky exploration and observation planning, independent of connections and equipment. The
// layout is in place (toolbar, sky viewport, and object inspector), and the atlas, search, and object
// data arrive with the planetarium; until then nothing is simulated.

// Sky workspace.
export function SkyWorkspace() {
	return (
		<WorkspaceLayout workspace="sky" title="Sky" panel={{ title: 'Object Inspector', content: <ObjectInspector /> }}>
			<div className="flex h-full flex-col bg-base-000">
				<div className="flex h-10 flex-none items-center gap-2 border-b border-line-100 bg-base-100 px-2">
					<input disabled placeholder="Search objects (coming soon)" className={cn(inputClassName, 'h-8 max-w-72 py-1 text-[13px]')} />
				</div>
				<div className="min-h-0 flex-1">
					<EmptyState title="Sky Atlas coming soon" description="The planetarium, object search, and visibility planning will appear here. No equipment is needed." />
				</div>
			</div>
		</WorkspaceLayout>
	)
}

// Contextual panel of the Sky workspace with the selected object's data; empty until objects can be
// selected.
function ObjectInspector() {
	return (
		<>
			<PanelSection title="Object">
				<p className="m-0 text-ink-300">No object selected.</p>
			</PanelSection>
			<PanelSection title="Coordinates">
				<PlannedControls items={['Right ascension and declination', 'Altitude and azimuth']} />
			</PanelSection>
			<PanelSection title="Visibility">
				<PlannedControls items={['Rise, transit, and set', 'Altitude chart']} />
			</PanelSection>
			<PanelSection title="Equipment">
				<PlannedControls items={['Slew the mount', 'Frame with the main camera']} />
			</PanelSection>
		</>
	)
}
