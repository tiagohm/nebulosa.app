import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { ImageStatisticsMolecule } from '@/molecules/image/statistics'
import { Checkbox } from './components/Checkbox'
import { Histogram } from './components/Histogram'
import { TextInput } from './components/TextInput'
import { ImageChannelButtonGroup } from './ImageChannelButtonGroup'
import { Modal } from './Modal'

const CHANNEL_VALUES = ['RED', 'GREEN', 'BLUE'] as const

function selectedChannelIndex(value: (typeof CHANNEL_VALUES)[number]) {
	return value === 'GREEN' ? 1 : value === 'BLUE' ? 2 : 0
}

function channelValueOf(index: number) {
	return CHANNEL_VALUES[index] ?? CHANNEL_VALUES[0]
}

function formatStat(value: number, fractionDigits: number) {
	return Number.isFinite(value) ? value.toFixed(fractionDigits) : '--'
}

export const ImageStatistics = memo(() => {
	const statistics = useMolecule(ImageStatisticsMolecule)

	return (
		<Modal header="Statistics" id={`settings-${statistics.viewer.storageKey}`} maxWidth="296px" onHide={statistics.hide}>
			<Body />
		</Modal>
	)
})

const Body = memo(() => {
	const statistics = useMolecule(ImageStatisticsMolecule)
	const { histogram } = useSnapshot(statistics.state)

	return (
		<div className="mt-0 grid grid-cols-12 gap-2">
			<Options />
			<Stats />
			<div className="col-span-full">
				<Histogram className="h-30 w-full rounded-lg bg-neutral-950/40" histogram={histogram} />
			</div>
		</div>
	)
})

const Options = memo(() => {
	const statistics = useMolecule(ImageStatisticsMolecule)
	const { histogram, selected } = useSnapshot(statistics.state)
	const { transformed } = useSnapshot(statistics.state.request)

	return (
		<>
			<Checkbox className="col-span-full min-w-0" label="Transformed" onValueChange={(value) => statistics.update('transformed', value)} value={transformed} />
			{histogram.length === 3 && <ImageChannelButtonGroup className="col-span-full min-w-0" onValueChange={(value) => (statistics.state.selected = selectedChannelIndex(value ?? 'RED'))} value={channelValueOf(selected)} />}
		</>
	)
})

const Stats = memo(() => {
	const statistics = useMolecule(ImageStatisticsMolecule)
	const { histogram, selected } = useSnapshot(statistics.state)
	const hs = histogram[selected] ?? histogram[0]

	if (hs === undefined) return null

	return (
		<>
			<TextInput className="col-span-6 min-w-0" label="Count: Total | Max" readOnly value={`${formatStat(hs.count[0], 0)} | ${formatStat(hs.count[1], 0)}`} />
			<TextInput className="col-span-6 min-w-0" label="Mean" readOnly value={formatStat(hs.mean, 8)} />
			<TextInput className="col-span-6 min-w-0" label="Median" readOnly value={formatStat(hs.median, 8)} />
			<TextInput className="col-span-6 min-w-0" label="Variance" readOnly value={formatStat(hs.variance, 8)} />
			<TextInput className="col-span-6 min-w-0" label="Std Dev" readOnly value={formatStat(hs.standardDeviation, 8)} />
			<TextInput className="col-span-6 min-w-0" label="Min | Max" readOnly value={`${formatStat(hs.minimum[0], 6)} | ${formatStat(hs.maximum[0], 6)}`} />
		</>
	)
})
