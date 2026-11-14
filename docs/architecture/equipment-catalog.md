# Equipment Catalog Contract

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Equipment Catalog is the stable identity of the physical cameras that calibration frames and masters are recorded against, whatever connection, endpoint, or driver reaches them.
It has two parts: the cameras of the catalog, kept with the workspace, and the binding of each camera device to one of them, kept by the `api`.

- **Cameras.**
  A camera of the catalog (`CatalogCamera` of `api/src/workspace.ts`) has an id the tab that created it generates (`nanoid`) and that never changes, a name unique without regard to case (`409 nameTaken`), an optional model, serial number, and notes for people only, an optional declared sensor (`CatalogCameraSensor`: unbinned width and height in pixels, pixel size in micrometers, CFA pattern, bits), and whether it is archived.
  It is one catalog shared by every profile, tab, and browser, like the observing sites: read in `GET /api/workspace` (`cameras`), written unit by unit from its revision by `WorkspaceSync` (`PUT` and `DELETE /api/catalog-cameras/:id`, `409 conflict` with the camera the server kept), and published as `catalogCamera:updated` and `catalogCamera:removed`.
  Nothing compares a model, a serial number, or a name with a frame; the declared sensor only warns of a binding to a device that reports another one.
  An archived camera is no longer offered to new bindings, imports, or declarations, and keeps everything recorded against it.
  A camera calibration frames or masters are recorded against cannot be deleted (`409 cameraInUse` with `usage`, `CatalogCameraUsage`), which the database enforces too (`ON DELETE RESTRICT`); deleting one removes its bindings (`ON DELETE CASCADE`, published as unbound) and clears it from the captured frames and stacked lights that named it (`ON DELETE SET NULL`).
- **Bindings.**
  A binding (`CameraBinding` of `api/src/equipmentcatalog.ts`) says which camera of the catalog a camera device is, keyed by the device as the operations know it (`OperationDevice`: the id of its open connection, the MD5 of its endpoint, and its device id), with the hardware id and driver name the device had when it was bound.
  It belongs to the physical device, not to a profile: the wizards, the captures, and the calibrators run on the server and only know the device, never the profile that started them, so it holds for every profile that uses the device.
  It is edited in the Equipment Setup (`CatalogBinding` of `web/src/equipment/`, under the Main Camera and Guide Camera roles), through `PUT /api/equipment-catalog/bindings` (`{ connectionId, deviceId, cameraId | null }`, `404 notFound` for a device that is not a camera of an open connection or a camera that is not in the catalog), read by `GET /api/equipment-catalog/bindings`, and published as `catalogCamera:bindingChanged`; the web mirrors it in `cameraBindingsState` (`web/src/equipment/catalog.ts`, in `SERVER_STORES`).
  The last write wins, and no history is kept: every frame records the camera of its binding once, when it is taken, so binding a device again never changes what was recorded.
  `EquipmentCatalog.cameraOf(device)` resolves the camera of a device from memory; the services that record or calibrate frames receive it as `CameraBindings`.
- **Resolution.**
  The Dark Library Wizard resolves the camera when it makes a plan (`DarkCapturePlan.camera.cameraId`), and the Flat Wizard when its session starts (`FlatFrameRegistration.cameraId`); both refuse to start a device bound to none (`409 cameraNotCataloged`).
  An import of the Calibration Library takes the camera from the operator, for the whole import or file by file, and commits nothing while a file that would enter has none (`409 cameraRequired`); the review suggests the camera of the one binding whose driver name is the `INSTRUME` every file of the page gives, which the operator confirms, since two units of one model give the same name.
  `CaptureFrameRegistry` records in `capture_frames.camera_id` the camera bound when it first learns of a frame, and never refuses a capture of a device bound to none.
  Guiding and Live Stacking resolve the camera when their session starts, iPolar when a pinned dark is checked at its start, and Image Stacking from `capture_frames` by the path of each light (see the [Calibration Library Contract](calibration-library.md)).
- **Settings.**
  Settings → Equipment Catalog (`web/src/settings/EquipmentCatalogSettings.tsx`, `/settings/equipment-catalog[/<camera id>]`) lists the cameras with how many devices are bound to each and how many frames and masters the library records against it, and edits one at a time as a local draft only Save writes; its sensor and model can be copied from a connected camera.
  New Camera of the Equipment Setup creates a camera named after the device, with the model and sensor it reports, through the route at once, and binds the device to it.
- **Limitations.**
  An endpoint whose host, port, or protocol changes is another connection, so its devices are unbound until bound again; the Equipment Setup suggests the camera bound to a device of the same driver name.
  One camera reached through INDI and through Alpaca is two devices, each bound to it on purpose.
  Two cameras a driver names by enumeration order and that swap USB ports keep their names, so their bindings follow the names, not the cameras: without a serial number nothing can tell, and the sensor warning only catches different models.
