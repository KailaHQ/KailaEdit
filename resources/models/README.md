# On-device models

Weights used by the offline background removal (auto matte) feature. They are loaded by
`electron/matte/onnx-session.ts` in the main process, and copied into `public/models/` for
the renderer by `scripts/prepare-ml-assets.mjs`.

| File | Size | Model | License |
|---|---|---|---|
| `rvm_mobilenetv3.onnx` | ~15 MB | RobustVideoMatting, MobileNetV3 backbone | **GPL-3.0** |

Source: <https://github.com/PeterL1n/RobustVideoMatting>

## Why this file is committed

It is the only artifact here that cannot be regenerated from anything else in the tree, so
it is tracked rather than downloaded — the app must keep working with no network. Its two
copies (`public/models/`, and the unpacked copy inside a packaged build) are generated, not
committed; see `.gitignore`.

## Before adding another model

1. Check its license and add an entry to `NOTICES.md` — the GPL-3.0 status of the file
   above is the reason that file carries the full GPL text.
2. Add its id to `autoMatteModelValues` in `core/src/project-model.ts`. A value listed there
   without a matching `.onnx` file will fail at bake time with "Model file not found",
   which is what `modnet` currently does.
