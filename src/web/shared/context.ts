import type { Camera, Cover, Device, DewHeater, FlatPanel, Focuser, GuideOutput, Mount, Rotator, Thermometer, Wheel } from 'nebulosa/src/indi.device'
import { createContext } from 'react'
import type { AutoFocusStore } from '@/stores/autofocus.store'
import type { CameraStore } from '@/stores/camera.store'
import type { CoverStore } from '@/stores/cover.store'
import type { DarvStore } from '@/stores/darv.store'
import type { DewHeaterStore } from '@/stores/dewheater.store'
import type { FilePickerStore } from '@/stores/filepicker.store'
import type { FlatPanelStore } from '@/stores/flatpanel.store'
import type { FlatWizardStore } from '@/stores/flatwizard.store'
import type { FocuserStore } from '@/stores/focuser.store'
import type { GuideOutputStore } from '@/stores/guideoutput.store'
import type { ImageViewerStore } from '@/stores/image.viewer.store'
import type { IndiPanelControlStore } from '@/stores/indi.panelcontrol.store'
import type { MountStore } from '@/stores/mount.store'
import type { RotatorStore } from '@/stores/rotator.store'
import type { ThermometerStore } from '@/stores/thermometer.store'
import type { TppaStore } from '@/stores/tppa.store'
import type { WheelStore } from '@/stores/wheel.store'
import type { LocationStore } from '../stores/location.store'
import type { Image } from './types'

export const AutoFocusStoreContext = createContext<AutoFocusStore>(null as never)

export const CameraDeviceContext = createContext<Camera>(null as never)
export const CameraStoreContext = createContext<CameraStore>(null as never)

export const DeviceContext = createContext<Device>(null as never)

export const CoverDeviceContext = createContext<Cover>(null as never)
export const CoverStoreContext = createContext<CoverStore>(null as never)

export const DarvStoreContext = createContext<DarvStore>(null as never)

export const DewHeaterDeviceContext = createContext<DewHeater>(null as never)
export const DewHeaterStoreContext = createContext<DewHeaterStore>(null as never)

export const FlatPanelDeviceContext = createContext<FlatPanel>(null as never)
export const FlatPanelStoreContext = createContext<FlatPanelStore>(null as never)

export const FlatWizardStoreContext = createContext<FlatWizardStore>(null as never)

export const FilePickerStoreContext = createContext<FilePickerStore>(null as never)

export const FocuserDeviceContext = createContext<Focuser>(null as never)
export const FocuserStoreContext = createContext<FocuserStore>(null as never)

export const GuideOutputDeviceContext = createContext<GuideOutput>(null as never)
export const GuideOutputStoreContext = createContext<GuideOutputStore>(null as never)

export const ImageContext = createContext<Image>(null as never)
export const ImageViewerStoreContext = createContext<ImageViewerStore>(null as never)

export const IndiPanelControlStoreContext = createContext<IndiPanelControlStore>(null as never)

export const LocationStoreContext = createContext<LocationStore>(null as never)

export const MountDeviceContext = createContext<Mount>(null as never)
export const MountStoreContext = createContext<MountStore>(null as never)

export const RotatorDeviceContext = createContext<Rotator>(null as never)
export const RotatorStoreContext = createContext<RotatorStore>(null as never)

export const ThermometerDeviceContext = createContext<Thermometer>(null as never)
export const ThermometerStoreContext = createContext<ThermometerStore>(null as never)

export const TppaStoreContext = createContext<TppaStore>(null as never)

export const WheelDeviceContext = createContext<Wheel>(null as never)
export const WheelStoreContext = createContext<WheelStore>(null as never)
