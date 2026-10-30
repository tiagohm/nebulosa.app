import type { MountPointingSessionSummary } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { SegmentedControl } from '../ui/SegmentedControl'
import { loadPointingModel, mountPointingRuntime } from './mountpointing'
import { PointingDiagnostics, PointingMeasures, PointingSampleInspector } from './PointingDiagnostics'
import { PointingMap, type PointingMapVectors } from './PointingMap'
import { shownRevision } from './skymap'

// Pointing Map view of the bottom area of a camera tab: the map of the session of its camera, the measures of its model
// beneath it, and, in the same view, the diagnostics of the latest fit and the sample selected. The record of the model is
// fetched here when it is shown, and again by the store whenever the model changes, so the view follows a running session.
// Nothing here starts, stops, or edits anything. Maximize shows the same map larger.

// Choices of the arrows of the map, in control order.
const VECTORS: readonly PointingMapVectors[] = ['raw', 'residual', 'none']

// Label of each choice of the arrows.
const VECTOR_LABELS: Readonly<Record<PointingMapVectors, string>> = { raw: 'Raw Errors', residual: 'Left by Model', none: 'No Arrows' }

// Pointing Map of a session.
export function PointingMapView({ session }: { readonly session: MountPointingSessionSummary }) {
	const { modelId, kind, waypoint } = session
	const runtime = useSnapshot(mountPointingRuntime)
	const model = runtime.details[modelId]
	const [vectors, setVectors] = useState<PointingMapVectors>('raw')
	const [selected, setSelected] = useState<string>()
	const [maximized, setMaximized] = useState(false)

	useEffect(() => {
		void loadPointingModel(mountPointingRuntime, modelId)
	}, [modelId])

	if (!model) return <p className="m-0 p-2 text-xs text-ink-300">Loading…</p>

	const revision = shownRevision(model)
	const sample = model.samples.find((each) => each.id === selected)
	// A verification counts its own targets, which are not waypoints of the plan drawn.
	const map = <PointingMap model={model} residuals={revision?.residuals} vectors={vectors} current={kind === 'acquisition' ? waypoint : undefined} selected={selected} onSelect={setSelected} />

	return (
		<div className="flex h-64 min-h-0 gap-3 max-sm:h-auto max-sm:flex-col">
			<div className="aspect-square h-full flex-none max-sm:mx-auto max-sm:h-56">{map}</div>
			<div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
				<PointingMeasures model={model} revision={revision} />
				<div className="flex flex-wrap items-center gap-2">
					<SegmentedControl options={VECTORS} value={vectors} format={(option) => VECTOR_LABELS[option]} onChange={setVectors} />
					<Button variant="secondary" onClick={() => setMaximized(true)}>
						Maximize
					</Button>
				</div>
				{sample && <PointingSampleInspector sample={sample} revision={revision} />}
				<PointingDiagnostics model={model} revision={revision} />
			</div>
			<Modal open={maximized} onClose={() => setMaximized(false)} title="Pointing Map" className="max-w-3xl" fit>
				<div className="aspect-square w-full max-h-[70vh]">{map}</div>
			</Modal>
		</div>
	)
}
