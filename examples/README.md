# Examples

This directory contains public, code-backed references and deterministic test fixtures. It is not used to initialize new jobs.

- `traework-reference/` is a subtitle-led style kit extracted from the TraeWork good case. Its reusable MG modules live under `hyperframes/mg/`; the written breakdown and recipe explain the design decisions but do not replace the code.
- `book-video-reference/` documents the approved Book Video look. Its grid, annotation, and reversible axis transition have been promoted to the [motion template library](../templates/motion-graphics/README.md).
- Root `*.example.*` files are small, populated workflow-artifact fixtures used by contract and planning tests, and to document artifact shapes. They are not job templates and are never copied into `jobs/`.

New successful video cases enter `examples/` with their source and a short usage description. When a case also works for reuse with changes limited to content, assets, and timing, promote its reusable implementation to `templates/motion-graphics/` and update the example's links. Keep one canonical implementation per promoted effect; the example retains its case-specific explanation. This is a maintenance convention, not a new production gate.

Use [`templates/job/`](../templates/job/) for default job documents and state, and [`templates/hyperframes/`](../templates/hyperframes/) for the HyperFrames scaffold. Keep private media, credentials, full job state, and unapproved source assets under the ignored `jobs/` directory.
