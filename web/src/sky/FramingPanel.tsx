import { cn } from 'cn'
import { formatFixed } from '../format'
import { fieldSummary } from '../framing/OpticsFields'
import { frameSwatch } from '../framing/palette'
import { missingCameraName, type ResolvedFraming } from '../framing/resolve'
import { profileState, setFramingShownInSky, setFramingVisible } from '../profile/profile'
import type { SkyFramingSettings } from '../profile/schema'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { showFraming } from '../tools/framing/framing'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { Notice } from '../ui/Notice'

// Framing panel of the Sky workspace: the framings of the Framing tool, each in its colour with its field, drawn around
// the selected object unless hidden, and whether the fields of view are drawn at all. It only shows them: framings are
// created and edited in the Framing tool, and which are shown is view state of the profile.

// Props of the panel.
export interface FramingPanelProps {
	// Framings resolved for the tab, the Equipment Setup's first, each with its colour.
	readonly framings: readonly ResolvedFraming[]
	// Which framings the profile draws; absent before the first change.
	readonly framing?: Readonly<SkyFramingSettings>
	// Whether the selected object has a position the fields of view can be drawn at.
	readonly hasTarget: boolean
}

// Framing panel.
export function FramingPanel({ framings, framing, hasTarget }: FramingPanelProps) {
	const visible = framing?.visible ?? false
	const hidden = framing?.hidden ?? []
	const shown = framings.filter((each) => !hidden.includes(each.id)).length

	return (
		<>
			<CollapsibleSection id="sky.framing.display" title="Display">
				<Checkbox label="Show fields of view" checked={visible} onChange={(next) => setFramingVisible(profileState, next)} />
				{visible && !hasTarget && <Notice>The fields of view are drawn around the selected object, once its position is known.</Notice>}
			</CollapsibleSection>
			<CollapsibleSection id="sky.framing.framings" title="Framings" summary={`${shown} of ${framings.length} shown`}>
				<ul className="m-0 flex list-none flex-col gap-1 p-0">
					{framings.map((each) => {
						const drawn = !hidden.includes(each.id)

						return (
							<li key={each.id} className="flex items-start gap-2">
								<span className={cn('mt-2 size-3 flex-none rounded-full', frameSwatch(each.color), !drawn && 'opacity-40')} />
								<div className="min-w-0 flex-1">
									<Checkbox label={each.name} checked={drawn} disabled={!visible} onChange={(next) => setFramingShownInSky(profileState, each.id, next)} />
									<p className="m-0 text-xs leading-5 text-ink-300">
										{fieldSummary(each.field, missingCameraName(each.camera))} · PA {formatFixed(each.optics.rotation, 1)}°
									</p>
								</div>
							</li>
						)
					})}
				</ul>
				<div>
					<Button variant="secondary" onClick={() => showFraming(framings[0].id)}>
						Open Framing
					</Button>
				</div>
				<Notice>Framings are created and edited in the Framing tool, with their telescope, camera, and rotation; the Sky only draws them.</Notice>
			</CollapsibleSection>
		</>
	)
}
