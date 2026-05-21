import type { Camera, Cover, DewHeater, FlatPanel, Focuser, GuideOutput, Mount, Rotator, Thermometer, Wheel } from 'nebulosa/src/indi.device'
import { createContext } from 'react'
import type { CameraStore } from '@/store/camera.store'
import type { CoverStore } from '@/store/cover.store'
import type { DarvStore } from '@/store/darv.store'
import type { DewHeaterStore } from '@/store/dewheater.store'
import type { FlatPanelStore } from '@/store/flatpanel.store'
import type { FocuserStore } from '@/store/focuser.store'
import type { GuideOutputStore } from '@/store/guideoutput.store'
import type { MountStore } from '@/store/mount.store'
import type { RotatorStore } from '@/store/rotator.store'
import type { ThermometerStore } from '@/store/thermometer.store'
import type { TppaStore } from '@/store/tppa.store'
import type { WheelStore } from '@/store/wheel.store'
import type { AutoFocusStore } from '../store/autofocus.store'
import type { FilePickerStore } from '../store/filepicker.store'

export const AutoFocusStoreContext = createContext<AutoFocusStore>(null as never)

export const CameraDeviceContext = createContext<Camera>(null as never)
export const CameraStoreContext = createContext<CameraStore>(null as never)

export const CoverDeviceContext = createContext<Cover>(null as never)
export const CoverStoreContext = createContext<CoverStore>(null as never)

export const DarvStoreContext = createContext<DarvStore>(null as never)

export const DewHeaterDeviceContext = createContext<DewHeater>(null as never)
export const DewHeaterStoreContext = createContext<DewHeaterStore>(null as never)

export const FlatPanelDeviceContext = createContext<FlatPanel>(null as never)
export const FlatPanelStoreContext = createContext<FlatPanelStore>(null as never)

export const FilePickerStoreContext = createContext<FilePickerStore>(null as never)

export const FocuserDeviceContext = createContext<Focuser>(null as never)
export const FocuserStoreContext = createContext<FocuserStore>(null as never)

export const GuideOutputDeviceContext = createContext<GuideOutput>(null as never)
export const GuideOutputStoreContext = createContext<GuideOutputStore>(null as never)

export const MountDeviceContext = createContext<Mount>(null as never)
export const MountStoreContext = createContext<MountStore>(null as never)

export const RotatorDeviceContext = createContext<Rotator>(null as never)
export const RotatorStoreContext = createContext<RotatorStore>(null as never)

export const ThermometerDeviceContext = createContext<Thermometer>(null as never)
export const ThermometerStoreContext = createContext<ThermometerStore>(null as never)

export const TppaStoreContext = createContext<TppaStore>(null as never)

export const WheelDeviceContext = createContext<Wheel>(null as never)
export const WheelStoreContext = createContext<WheelStore>(null as never)
