# Regression tests

These tests protect editing, caption planning, MG timing, media delivery and repository privacy. They are developer maintenance tools, not extra steps or gates in a video job.

Run a focused test with `node tests/test-mg-components.mjs` or another test file. The ChatCut test mocks requests; it does not upload media or edit a project. The preview-player test needs no generated gallery.

The existing maintenance entrypoint remains `bash scripts/verify-repository.sh --static`. For media/runtime coverage, use `CUT_MOTION_FONT=/absolute/path/to/font.woff2 bash scripts/verify-repository.sh --runtime`; FFmpeg and the configured local renderer must be available. Runtime tests use temporary fixtures, not private job media.
