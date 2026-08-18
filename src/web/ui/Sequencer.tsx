import { useStore } from '@hooks/store.hook'
import { sequencerStore } from '@stores/sequencer.store'
import type { IDockviewPanelProps } from 'dockview-react'
import { memo } from 'react'

export const Sequencer = memo(({ api }: IDockviewPanelProps) => {
	const sequencer = useStore(() => sequencerStore(api), [api.id])

	return <div></div>
})
