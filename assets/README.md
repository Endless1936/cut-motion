# Shared assets

Store redistributable icons, palettes, font instructions, and reference media here.

Do not commit user footage, credentials, exported videos, or third-party assets without a compatible license. Job-specific media belongs under `jobs/<job-id>/input/` and is ignored by Git.

Generated MG previews live under `assets/previews/mg/`, which Git ignores. Open `gallery/index.html` to view the same gallery that GitHub Pages serves. Browser diagnostics go to `checks/`. [MG preview commands](../templates/motion-graphics/README.md#preview-and-stage-helpers)

## Display font cache

`assets/fonts/` is the shared local cache for the design system's display font, in any format (`woff2`, `ttf`, `otf`). Font files stay out of Git; only the accompanying `LICENSE.txt` is committed. `scripts/install-font.sh <job-directory>` copies from this cache into a job, repoints `state/design-system.json`, and rewrites the `@font-face` in the HyperFrames template so the declared format matches the installed file. Install once here and later jobs skip the search.
