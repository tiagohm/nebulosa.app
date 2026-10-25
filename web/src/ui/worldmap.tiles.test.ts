import { describe, expect, test } from 'bun:test'
import { WORLD_MAP_HEIGHT, WORLD_MAP_WIDTH } from './worldmap.geometry'
import { ancestorSource, MAX_TILE_LEVEL, PERMANENT_TILE_LEVELS, permanentTiles, TILE_SIZE, tileKey, tileLevel, tileRows, tileScale, visibleTiles } from './worldmap.tiles'
import { parseWorldMapSvg } from './worldmap.worker'

describe('levels', () => {
	test('scale and rows', () => {
		expect(tileScale(0) * WORLD_MAP_WIDTH).toBeCloseTo(TILE_SIZE, 9)
		expect(tileRows(0)).toBe(1)
		expect(tileRows(1)).toBe(1)
		expect(tileRows(4)).toBe(8)
	})

	test('picks the coarsest level not enlarged', () => {
		expect(tileLevel(tileScale(3))).toBe(3)
		expect(tileLevel(tileScale(3) * 1.01)).toBe(4)
		expect(tileLevel(tileScale(3) * 0.99)).toBe(3)
		expect(tileLevel(0)).toBe(0)
		expect(tileLevel(1e6)).toBe(MAX_TILE_LEVEL)
	})

	test('permanent tiles cover the coarsest levels', () => {
		const tiles = permanentTiles()
		expect(tiles[0]).toEqual({ level: 0, x: 0, y: 0 })
		expect(tiles.every((tile) => tile.level <= PERMANENT_TILE_LEVELS)).toBe(true)
		expect(tiles).toHaveLength(1 + 2 + 8 + 32)
	})
})

describe('visible tiles', () => {
	const size = WORLD_MAP_WIDTH / 4

	test('covers the region, nearest the center first', () => {
		const tiles = visibleTiles(2, { x: size * 0.5, y: 0, width: size * 2, height: size }, false)
		expect(tiles.map((tile) => tile.column).sort((a, b) => a - b)).toEqual([0, 1, 2])
		expect(tiles[0].column).toBe(1)
		expect(tiles.every((tile) => tile.id.y === 0)).toBe(true)
	})

	test('repeats columns across the antimeridian when wrapping', () => {
		const tiles = visibleTiles(2, { x: -size * 0.5, y: 0, width: size, height: size / 2 }, true)
		expect(tiles.map((tile) => [tile.column, tile.id.x])).toContainEqual([-1, 3])
		expect(tiles.map((tile) => [tile.column, tile.id.x])).toContainEqual([0, 0])
	})

	test('leaves out what is outside a map that does not wrap', () => {
		const tiles = visibleTiles(2, { x: -size, y: -size, width: WORLD_MAP_WIDTH + 2 * size, height: WORLD_MAP_HEIGHT + 2 * size }, false)
		expect(tiles).toHaveLength(4 * tileRows(2))
		expect(tiles.every((tile) => tile.column >= 0 && tile.column < 4)).toBe(true)
	})
})

test('ancestor source', () => {
	expect(ancestorSource({ level: 3, x: 5, y: 2 }, 1)).toEqual({ id: { level: 2, x: 2, y: 1 }, sx: TILE_SIZE / 2, sy: 0, size: TILE_SIZE / 2 })
	expect(ancestorSource({ level: 3, x: 5, y: 2 }, 3)).toEqual({ id: { level: 0, x: 0, y: 0 }, sx: (5 * TILE_SIZE) / 8, sy: (2 * TILE_SIZE) / 8, size: TILE_SIZE / 8 })
})

test('tile key', () => {
	expect(tileKey({ level: 4, x: 3, y: 1 })).toBe('4/3/1')
})

test('parses the shapes of the map', () => {
	const svg = `<svg><rect class="ocean"/><g class="countries">
<path d="M1,2L3,4z"/>
<polygon points="1,1 2,2 3,1 "/>
<polyline points="5,5 6,6"/>
</g>
<g class="lakes">
<path fill="red" d="M7 7h1v1z"/>
</g></svg>`
	expect(parseWorldMapSvg(svg)).toEqual({ countries: ['M1,2L3,4z', 'M1,1 2,2 3,1Z', 'M5,5 6,6'], lakes: ['M7 7h1v1z'] })
})
