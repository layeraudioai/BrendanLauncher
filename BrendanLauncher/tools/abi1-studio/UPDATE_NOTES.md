# ABI-1 Studio Update Package

## Highlights

- Scene-view navigation now includes right-button drag panning and arrow-key panning. Left drag on empty space still orbits, left drag on an object still moves it, and the wheel still zooms.
- The editor view target is saved in project JSON. Older v1/v2 projects without a view target normalize to the origin and continue to open.
- A reviewed, offline project-prompt workflow splits input in this order: newlines, periods, commas, then standalone `and`. Each resulting instruction is globally numbered and labeled with its last splitting delimiter and local part position.
- Refinement is the default: reviewed additions, direct property edits, renames, deletions, and generated scripts apply transactionally to a copy of the current project and preserve its scenes, assets, scripts, and metadata. A separate opt-in mode creates a new project.
- Prompt pieces can be edited in place, reordered by drag/drop or up/down buttons, removed, or added manually. Edits and reorderings rerun analysis so the displayed operation summary and target references stay current. Steps are applied in that visible order.
- The offline first-pass parser recognizes common mesh, sprite, and audio objects, named colors, direct color/scale/axis/primitive/rename/delete refinements, and behavior phrases supported by the existing GLSL script generator. Unmatched/unsupported steps are visible and skipped; applying an invalid operation fails as a whole without committing partial changes.
- It is a constrained deterministic local parser, not a general-purpose or cloud AI model. Review the operation summary, especially destructive steps, before confirming.
- Test command: `node --test *.test.cjs` from this directory.

## Update / install

1. Back up any customized `tools/abi1-studio` directory.
2. Replace it with this directory from the update archive (keep the path `BrendanLauncher/tools/abi1-studio`).
3. Open `index.html` in a current desktop browser. No Node installation is required to use Studio; Node is only needed for its test suite.
4. Open an existing project and verify its scenes, assets, and scripts before saving over the original.

- Added deterministic 36-character-alphabet seed workflows: generate a starter project from a short seed, derive a repeatable seed from an NLP project prompt, and export/import a compressed exact-project seed (`.hblseed`) with an integrity checksum.
- Full project seed decoding validates the alphabet, payload length, decompression size, JSON, and project schema before replacing the open project. Short seeds and full project seeds have distinct import/generation actions.

## Compatibility notes

- Existing project format versions 1 and 2 remain supported. Editor camera target data is additive; runtime camera transforms and ABI-1 scene encoding are unchanged.
- Project generation creates the initial objects and reusable scripts only. It does not synthesize imported image/audio assets, arbitrary geometry, physics, or unsupported GLSL. Review generated code and run PC Preview before building an app.
- Build output still targets ABI-1; this editor update does not change the launcher runtime or require updating installed apps until a newly built app is deployed.
