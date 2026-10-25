# Changes in this fork

This is a fork of [openscad/openscad-playground](https://github.com/openscad/openscad-playground)
(GPL-2.0-or-later, same licenses as upstream) used for https://openscad.matthewdeiter.com.

Changes relative to upstream:

- **Per-browser session persistence.** On a plain URL the session (sources, uploads, active file, layout)
  is saved in the visitor's own IndexedDB (`src/state/local-state.ts`, `src/state/idb-store.ts`).
  Nothing is stored server-side. Links containing a `#…` fragment keep upstream's URL-state behaviour
  and leave the saved session alone.
- **Upload file(s)** accepts any file. `.scad/.json/.txt/.md/.csv` are kept as editable text; everything
  else (DXF, SVG, STL, 3MF, images…) is stored byte-for-byte (`src/state/upload.ts`).
- **Share project**, **Download sources** and **Clear my saved data** menu items enabled.
- Fixed: the "New project" link was built from an unawaited promise; link encoding overflowed the stack
  on large content.
- Deployment build strips the "Fork me on GitHub" ribbon (done by the deploy script, not in this source).

`tests/e2e/persistence_upload.py` is a Playwright check for the above.
- **File management:** New file, Copy to new file and Delete this file in the editor menu; 2D / 3D / height-map /
  not-importable badges in the file picker.
- **Upload helper:** after uploading a DXF, SVG, STL/3MF or PNG, a button inserts starter code
  (`linear_extrude`, `import`, `surface`). For ASCII DXFs it also reads the layer names and drawing units
  (`$INSUNITS`) and adds the matching `scale()` and layer hint.
