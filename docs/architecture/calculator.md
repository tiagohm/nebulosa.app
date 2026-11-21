# Calculator

Part of the [architecture](../ARCHITECTURE.md) of Nebulosa.

The Calculator is a tool of the Reference group (`web/src/tools/calculator/`): task-oriented calculators chosen from one menu grouped by category (`catalog.ts`).
Each calculator composes the pure formulas of the toolkit behind one form, showing its formula, units, domain, and approximations.
The categories cover optics and field of view, sampling and focus, exposure and integration, visual observation, and atmosphere and conditions.

## Purpose

The operator often needs a quick answer while planning a rig or a night: the field and image scale of an optical train, whether a camera samples the seeing well, how long a stack takes, the dew point of the night.
The Calculator gathers these answers in one place, computed from the operator's own equipment rather than retyped from a spec sheet.

## Relations

- Uses the formulas of `nebulosa/src/astronomy/formulas` of the toolkit (`core`), and `resolveFraming`, so its field of view matches that of the framings.
- Imports an optical configuration by value from the Main or Guide Camera of the active profile's Equipment Setup, from a camera or telescope of the [Equipment Catalog](equipment-catalog.md), or from a framing of the [Framing](framing.md) tool (`sources.ts`).
- Fills a sensor from the camera model catalog and native optics from the telescope model catalog, both bundled by `web`.
- Hosted by the Tools workspace (see [Tools Integration](tools-integration.md)); the URL names the calculator shown.
- Involves no route, event, operation, or device: everything runs in the browser.

## Rules and Limitations

- An import never empties a field and is never followed: live changes, the profile, presets, and devices are never written or rewritten by it.
- The draft lives in React state while the tool is open, is never persisted, and starts over when the active profile changes.
- A field the calculation cannot use shows why instead of a previous result; no result is ever NaN or Infinity.
- Mode switches fix the direction of a calculation, so fields never depend on each other circularly.
- Results are idealized models (stacking gains, rule-of-thumb sampling, rectangular mosaics), never optimized layouts or measurements.
- Camera & Signal and Guiding & Tracking calculators are not provided yet.
