import type { AddGroupOptions, AddPanelOptions, DockviewApi, DockviewGroupPanel, DockviewIDisposable, EdgeGroupOptions, EdgeGroupPosition, IDockviewPanel, SerializedDockview } from 'dockview-react'
import type { RequiredOnly } from 'nebulosa/src/core/types'

const MAX_PANELS = 10

export type DockviewStore = ReturnType<typeof dockviewStore>

export interface SinglePanelOptions<P extends object = object> extends Readonly<Omit<AddPanelOptions<P>, 'position' | 'floating' | 'id' | 'component'>> {
	readonly index?: number
}

export interface MultiplePanelOptions<P extends object = object> extends Readonly<Omit<AddPanelOptions<P>, 'position' | 'floating' | 'id' | 'component'>> {
	readonly index?: number
}

export interface StoredLayout {
	readonly schemaVersion: number
	readonly layout: SerializedDockview
}

export interface DockviewStoreOptions {
	readonly layoutStorageKey: string
	readonly layoutSchemaVersion: number
}

export function dockviewStore<K extends string>(panels: Record<K, IDockviewPanel[]>, { layoutStorageKey, layoutSchemaVersion }: DockviewStoreOptions) {
	let saveTimer: number | undefined
	let layoutChangeDisposable: DockviewIDisposable | undefined

	function restoreLayout() {
		const serializedLayout = localStorage.getItem(layoutStorageKey)
		if (serializedLayout) return JSON.parse(serializedLayout) as StoredLayout
		return undefined
	}

	function saveLayout(api: DockviewApi) {
		const storedLayout: StoredLayout = { schemaVersion: layoutSchemaVersion, layout: api.toJSON() }
		localStorage.setItem(layoutStorageKey, JSON.stringify(storedLayout))
	}

	function registerOnDidLayoutChange(api: DockviewApi) {
		layoutChangeDisposable = api.onDidLayoutChange(() => {
			window.clearTimeout(saveTimer)
			saveTimer = window.setTimeout(() => saveLayout(api), 1000)
		})
	}

	function unregisterOnDidLayoutChange() {
		layoutChangeDisposable?.dispose()
		layoutChangeDisposable = undefined

		window.clearTimeout(saveTimer)
		saveTimer = undefined
	}

	function load(api: DockviewApi, action: (type: K, panel: IDockviewPanel) => boolean) {
		const storedLayout = restoreLayout()

		if (storedLayout) {
			try {
				api.fromJSON(storedLayout.layout)
			} catch (e) {
				console.error('unable to restore layout:', e)
				localStorage.removeItem(layoutStorageKey)
			}
		}

		for (const type of Object.keys(panels) as K[]) {
			const storedPanels: IDockviewPanel[] = []

			for (let i = 0; i < MAX_PANELS; i++) {
				const id = `${type}.${i}`
				const panel = api.getPanel(id)

				if (panel !== undefined) {
					if (action(type, panel) === false) {
						api.removePanel(panel)
						continue
					}

					console.info('loaded stored panel:', panel.id, panel.group.id, panel.params)

					storedPanels.push(panel)
					listenOnDidRemovePanel(api, storedPanels, panel)
				}
			}

			panels[type] = storedPanels
		}
	}

	function addSinglePanel(api: DockviewApi, type: K, options: SinglePanelOptions, group: Pick<DockviewGroupPanel, 'id'>, activate: boolean = true) {
		const activePanels = panels[type] ?? []

		if (activePanels.length > 0) {
			activate && activatePanel(api, activePanels[0])
			return activePanels[0]
		}

		const id = `${type}.0`
		const panel = api.addPanel({ renderer: 'onlyWhenVisible', ...options, id, component: type, position: { referenceGroup: group.id, index: options.index } })

		activePanels.push(panel)
		panels[type] = activePanels

		activate && activatePanel(api, panel)

		console.info('single panel added:', id)

		listenOnDidRemovePanel(api, activePanels, panel)

		return panel
	}

	function activatePanel(api: DockviewApi, panel: IDockviewPanel) {
		panel.api.setActive()

		const location = panel.api.location

		if (location.type === 'edge') {
			api.getEdgeGroup(location.position)?.expand()
		}
	}

	function listenOnDidRemovePanel(api: DockviewApi, panels: IDockviewPanel[], panel: IDockviewPanel) {
		const listener = api.onDidRemovePanel((e) => {
			if (e === panel) {
				const index = panels.indexOf(panel)

				if (index >= 0) {
					panels.splice(index, 1)
					console.info('panel removed:', panel.id)
				}

				listener.dispose()
			}
		})

		return listener
	}

	function addMultiplePanel(api: DockviewApi, type: K, options: MultiplePanelOptions, group: Pick<DockviewGroupPanel, 'id'>, activate: boolean = true) {
		const activePanels = panels[type] ?? []

		if (activePanels.length >= MAX_PANELS) return

		let referenceGroupId: string | undefined

		for (let i = 0; i < MAX_PANELS; i++) {
			const id = `${type}.${i}`
			const panel = activePanels.find((e) => e.id === id)

			if (panel === undefined) {
				const p = api.addPanel({ renderer: 'onlyWhenVisible', ...options, id, component: type, position: { referenceGroup: referenceGroupId ?? group.id } })
				activePanels.push(p)
				panels[type] = activePanels

				if (activate) activatePanel(api, p)

				console.info('multiple panel added:', id)

				listenOnDidRemovePanel(api, activePanels, p)

				return p
			} else if (panel.group.id === group.id) {
				referenceGroupId = panel.group.id
			}
		}
	}

	function addEdge(api: DockviewApi, position: EdgeGroupPosition, options: Omit<Readonly<EdgeGroupOptions>, 'id'>) {
		return api.getEdgeGroup(position) ?? api.addEdgeGroup(position, { collapsedSize: 38, collapsed: true, ...options, id: `edge.${position}` })
	}

	function toggleEdge(api: DockviewApi, position: EdgeGroupPosition) {
		api.setEdgeGroupVisible(position, !api.isEdgeGroupVisible(position))
	}

	function addGroup(api: DockviewApi, options: RequiredOnly<Readonly<AddGroupOptions>, 'id'>) {
		return api.getGroup(options.id) ?? api.addGroup({ ...options, direction: options.direction ?? 'within' })
	}

	return {
		panels,
		restoreLayout,
		saveLayout,
		registerOnDidLayoutChange,
		unregisterOnDidLayoutChange,
		load,
		addSinglePanel,
		addMultiplePanel,
		addEdge,
		toggleEdge,
		addGroup,
		activatePanel,
	} as const
}
