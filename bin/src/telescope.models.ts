import { TELESCOPE_MODEL_CATALOG_SCHEMA, type TelescopeModel } from 'api/equipmentcatalog.models'
import { type AstrobinTelescope, telescopes } from 'nebulosa/src/adapters/imaging/astrobin'
import { fullName, positiveSpec, readAll, runModelCatalog } from './astrobin'

// Generates the telescope model catalog the Equipment Catalog editor and the calculators offer to fill a telescope from,
// web/assets/telescopes.json.gz (not committed, gzipped): every telescope and lens of the AstroBin equipment database that
// declares an aperture or a focal length, in millimeters, read through the toolkit's AstroBin client. A zoom keeps its
// shortest focal length as the native one and its longest apart. Telescopes that declare neither are left out, since
// they fill nothing; models listed twice keep the first one. The writing, --force, and --empty are those of
// runModelCatalog.
// Usage: bun make:telescopes [--force] [--empty]

// Returns the model a telescope describes, or undefined when it declares neither an aperture nor a focal length. A
// value that is not a positive number is left out; a focal length range is ordered, whatever order AstroBin gives it in.
function telescopeModel(telescope: AstrobinTelescope): TelescopeModel | undefined {
	const aperture = positiveSpec(telescope.aperture)
	const lengths = [positiveSpec(telescope.minFocalLength), positiveSpec(telescope.maxFocalLength)].filter((length) => length !== undefined)
	const focalLength = lengths.length > 0 ? Math.min(...lengths) : undefined
	const maxFocalLength = lengths.length > 0 ? Math.max(...lengths) : undefined
	if (aperture === undefined && focalLength === undefined) return undefined

	return {
		model: fullName(telescope),
		...(aperture !== undefined && { aperture }),
		...(focalLength !== undefined && { focalLength }),
		...(maxFocalLength !== undefined && focalLength !== undefined && maxFocalLength > focalLength && { maxFocalLength }),
	}
}

await runModelCatalog<TelescopeModel>({
	// Generated file, loaded by web/src/equipment/TelescopeModelSearch.tsx.
	output: '../../web/assets/telescopes.json.gz',
	schema: TELESCOPE_MODEL_CATALOG_SCHEMA,
	name: 'telescope model',
	command: 'bun make:telescopes',
	read: async () => (await readAll('telescopes', telescopes)).flatMap((telescope) => telescopeModel(telescope) ?? []),
})
