# Examples

This directory contains public, code-backed references and deterministic test fixtures. It is not used to initialize new jobs.

- `gold-standard/` is a complete `motion-copy` good case. Its HyperFrames composition is the source of truth for that example; it is a quality reference, not a universal template.
- `traework-reference/` is a subtitle-led style kit extracted from the TraeWork good case. Its reusable MG modules live under `hyperframes/mg/`; the written breakdown and recipe explain the design decisions but do not replace the code.
- Root `*.example.*` files are small, populated workflow-artifact fixtures used by contract and planning tests, and to document artifact shapes. They are not job templates and are never copied into `jobs/`.

Every motion example should expose the code that produces the represented look. A prose-only design reference belongs in a references directory until its implementation is added.

Use [`templates/job/`](../templates/job/) for default job documents and state, and [`templates/hyperframes/`](../templates/hyperframes/) for the HyperFrames scaffold. Keep private media, credentials, full job state, and unapproved source assets under the ignored `jobs/` directory.
