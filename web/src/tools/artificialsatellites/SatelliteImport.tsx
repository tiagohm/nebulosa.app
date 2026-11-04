import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import { Button } from '../../ui/Button'
import { inputClassName } from '../../ui/Field'
import { Note } from '../eclipse/EclipsePanelParts'
import { artificialSatellitesState, importSatelliteElements } from './artificialsatellites'

// Import of element sets typed or pasted, the content of the Import Elements popover of the workspace actions. The text
// and the outcome are kept in the tool's state, so closing the popover loses neither.

// Import of element sets.
export function SatelliteImport() {
	const { importText, importing, importResult, importError } = useSnapshot(artificialSatellitesState)

	return (
		<div className="flex w-66 max-w-full flex-col gap-2">
			<textarea className={cn(inputClassName, 'h-40 resize-y py-2 font-mono text-xs')} placeholder={'OMM JSON, or TLE sets:\nISS (ZARYA)\n1 25544U 98067A …\n2 25544  51.6415 …'} value={importText} onChange={(event) => (artificialSatellitesState.importText = event.target.value)} />
			<Button className="self-start" disabled={importing || !importText.trim()} onClick={() => void importSatelliteElements(artificialSatellitesState)}>
				Import
			</Button>
			{importError && <Note danger>{importError}</Note>}
			{importResult && (
				<Note>
					{importResult.imported.length} imported{importResult.imported.length > 0 ? `: ${importResult.imported.map((entry) => entry.name).join(', ')}` : ''}.
					{importResult.rejected.length > 0 && ` ${importResult.rejected.length} left out (${importResult.rejected.map((entry) => `${entry.noradId ?? `#${entry.index + 1}`}: ${entry.error}`).join(', ')}).`} Imported elements are used for their satellites until you choose GP elements again.
				</Note>
			)}
		</div>
	)
}
