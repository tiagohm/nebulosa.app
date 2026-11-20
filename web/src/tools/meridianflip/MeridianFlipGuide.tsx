import { Notice } from '../../ui/Notice'
import { FlipSection } from './MeridianFlipSection'

// Explanation of the Meridian Flip tool, shown at the end of its main area under both sections: what the Monitor
// follows, what each request does, and how a flip pauses, reserves, verifies, and gives back the capture, guiding,
// Target Centering, Plate Solving, and Auto Focus of the Equipment Setup. Text only; it reads no state.

// Step of a flip, in the order it happens: its title and what it does.
interface GuideStep {
	// Short name of the step.
	readonly title: string
	// What happens in it and which tools it involves.
	readonly text: string
}

// Steps of the guide, from following the target to giving imaging back.
const STEPS: readonly GuideStep[] = [
	{
		title: 'Monitor',
		text: 'Enable follows the target the mount tracks once it has held still for the settle time. From the site and the position it forecasts the upper transit, the early warning before it, and the preferred window after it, which opens and closes at the minutes of Flip Window. It compares the pier side the driver reports with the side expected past the meridian and records each change as an event. It never moves the mount: a GoTo or a stop only makes it wait for the next settled target.',
	},
	{
		title: 'Requests',
		text: 'Flip When Eligible schedules one flip of this passage: the server waits for the window and flips by itself, and refuses a window that closes after the firmware limit. Flip Now flips at once, only once the window has opened. Check only asks what the server would decide. Nothing flips without one of these requests, a passage is never flipped twice, and a restart of the server forgets a scheduled flip.',
	},
	{
		title: 'Preparing',
		text: 'The capture running on the main camera finishes its current frame and is paused, as Camera Acquisition shows, and guiding through the guide output is suspended. The mount, the main camera, the guide output, and the focuser are then reserved, so no other tool commands them, and the server checks the mount still points at the target.',
	},
	{
		title: 'Flipping',
		text: "The mount crosses the meridian by the driver's own flip or a GoTo to the same target, as Flip Policy chooses, sent once and never corrected, then waits for the mount settle. A pier side the driver reports verifies the flip. Without one, or with a simulator, Target Centering solves the target before and after with the Plate Solving settings, and the flip is inferred from the field turned by half a turn.",
	},
	{
		title: 'Restoring',
		text: 'Once the flip is accepted, Target Centering recenters the target and Auto Focus refocuses, as Flip Policy asks, with the settings of the main camera summarized in Flip Settings. Guiding is then restored and the capture resumes by itself.',
	},
	{
		title: 'When It Fails',
		text: 'A flip that cannot be verified, an inferred one the policy does not accept, or a failed step leaves the capture paused, and guiding too after an uncertain motion: check the mount, the framing, and guiding, then use Resume Capture in the strip above. Stop Flip ends it at its current step. A notification reports how each flip ended.',
	},
]

// How It Works section of the Meridian Flip tool.
export function MeridianFlipGuide() {
	return (
		<FlipSection title="How It Works">
			<p className="m-0 text-sm leading-5 text-ink-200">
				A German equatorial mount must turn to the other side of its pier once the target it tracks crosses the meridian, or the telescope runs into the pier. This tool follows that passage and flips the mount between frames, pausing and giving back imaging around it. Everything runs on the server, so closing
				this tab or switching profile changes nothing.
			</p>
			<ol className="m-0 grid list-none gap-x-8 gap-y-4 p-0 md:grid-cols-2">
				{STEPS.map((step, index) => (
					<li key={step.title} className="flex min-w-0 gap-3">
						<span className="flex size-6 flex-none items-center justify-center rounded-full border border-line-200 text-xs leading-4 text-ink-200 tabular-nums">{index + 1}</span>
						<div className="flex min-w-0 flex-col gap-1">
							<span className="text-sm leading-5 font-semibold text-ink-100">{step.title}</span>
							<p className="m-0 text-sm leading-5 text-ink-200">{step.text}</p>
						</div>
					</li>
				))}
			</ol>
			<Notice>The firmware limit is only what you enter in Flip Policy; it is never read from or written to the mount, so a firmware that flips by itself must not be active as well. No dome is slaved and no rotator is moved.</Notice>
		</FlipSection>
	)
}
