import { useSnapshot } from 'valtio'
import type { EquipmentTelescopes, TelescopeOptics } from '../framing/geometry'
import { type CatalogTelescope, catalogState } from './catalog'

// Telescopes of the Equipment Setup resolved through the Equipment Catalog. The Telescope and Guide Telescope of a profile
// may refer to a telescope of the catalog (TelescopeOptics.telescopeId): the aperture and native focal length it declares
// then replace the profile's, every value it does not declare is the profile's, and the reducer or Barlow is always the
// profile's. Choosing a telescope copies what it declares into the profile, so a telescope deleted later leaves the
// profile on its last copy. Nothing here commands a device.

// Telescope of the catalog the optics refer to; undefined without a reference or for a telescope the catalog no longer
// holds. An archived telescope still resolves.
export function referencedTelescope<T extends Pick<CatalogTelescope, 'id'>>(optics: Readonly<Pick<TelescopeOptics, 'telescopeId'>> | undefined, telescopes: readonly T[]): T | undefined {
	const id = optics?.telescopeId
	return id === undefined ? undefined : telescopes.find((telescope) => telescope.id === id)
}

// Returns the optics of a profile with the aperture and focal length, in millimeters, the telescope it refers to declares;
// the optics as they are without a reference, for a telescope no longer in the catalog, or when absent.
export function resolveTelescope(optics: Readonly<TelescopeOptics> | undefined, telescopes: readonly Readonly<Pick<CatalogTelescope, 'id' | 'aperture' | 'focalLength'>>[]): TelescopeOptics | undefined {
	const telescope = referencedTelescope(optics, telescopes)
	if (!optics || !telescope) return optics
	return { ...optics, focalLength: telescope.focalLength ?? optics.focalLength, aperture: telescope.aperture ?? optics.aperture }
}

// Returns the telescope and guide telescope of a profile resolved through the catalog (resolveTelescope).
export function resolveTelescopes({ telescope, guideTelescope }: Readonly<EquipmentTelescopes>, telescopes: readonly Readonly<Pick<CatalogTelescope, 'id' | 'aperture' | 'focalLength'>>[]): EquipmentTelescopes {
	return { telescope: resolveTelescope(telescope, telescopes), guideTelescope: resolveTelescope(guideTelescope, telescopes) }
}

// Returns the optics of a profile that refer to a telescope of the catalog, with the values it declares copied in, the
// reducer or Barlow kept; or that refer to none, keeping the values last copied, for an undefined telescope.
export function referToTelescope(optics: Readonly<TelescopeOptics>, telescope: Readonly<Pick<CatalogTelescope, 'id' | 'aperture' | 'focalLength'>> | undefined): TelescopeOptics {
	const { telescopeId: _, ...rest } = optics
	if (!telescope) return rest
	return { ...rest, focalLength: telescope.focalLength ?? optics.focalLength, aperture: telescope.aperture ?? optics.aperture, telescopeId: telescope.id }
}

// Returns how many profiles refer to a telescope of the catalog, as their telescope or guide telescope.
export function profilesUsingTelescope(profiles: readonly { readonly settings: Readonly<EquipmentTelescopes> }[], id: string) {
	return profiles.filter(({ settings }) => settings.telescope?.telescopeId === id || settings.guideTelescope?.telescopeId === id).length
}

// Says how many profiles use a telescope of the catalog.
export function telescopeUsage(count: number) {
	return count === 0 ? 'No profile uses this telescope.' : count === 1 ? 'One profile uses this telescope.' : `${count} profiles use this telescope.`
}

// Telescope and guide telescope of a profile's Equipment Setup resolved through the catalog of the tab, following both.
export function useProfileTelescopes(settings: Readonly<EquipmentTelescopes>): EquipmentTelescopes {
	return resolveTelescopes(settings, useSnapshot(catalogState).telescopes)
}
