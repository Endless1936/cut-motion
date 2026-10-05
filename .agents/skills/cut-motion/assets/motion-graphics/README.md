# Motion Graphics templates

13 reusable content templates for a 1080×1920 talking-head video, plus two stage helpers. Choose by meaning, then supply content and spoken anchors. Counts in examples are not limits.

## Coverage and selection

| Scene category | Count | Template | Use |
| --- | ---: | --- | --- |
| Sequence / process | 2 | [ordered-steps](ordered-steps/), [linear-flow](linear-flow/) | Numbered actions or connected input → processing → output |
| Independent points | 1 | [parallel-points](parallel-points/) | Features, conditions, resources; optional final conclusion |
| Relationships / conversion | 3 | [relation-map](relation-map/), [converge-sources](converge-sources/), [map-transform](map-transform/) | One → many, many → one, one → one respectively |
| Comparison / correction | 2 | [comparison](comparison/), [correction](correction/) | Alternatives or old wording → strike → replacement |
| Measured result | 1 | [metric-proof](metric-proof/) | Source, value and unit, explanatory caption |
| Evidence | 1 | [evidence-focus](evidence-focus/) | One or more regions of a real screenshot |
| Statement / quotation | 1 | [quote](quote/) | Statement with optional attribution |
| Technical instruction | 1 | [code-snippet](code-snippet/) | Commands or code with a selected emphasis |
| Supplementary note | 1 | [annotation](annotation/) | One short note or separately timed pieces |

The 13 types cover ordinary talking-head explanations. Complex charts and multilevel graphs may need a custom MG; a different item count alone does not.

## Shared design

Content MGs start at `topPx:280`. The overall MG and background card are horizontally centered, including narrow vertical lists. Internal rows may align left; headings stay inside their card. Ordered steps, vertical linear flows and quotations default to 720px wide; `widthPx` can set a centered width, capped at 88% of the canvas. Fit tall cards above captions by choosing a compact layout, moving the whole card upward or splitting a dense beat; eyes and mouth do not need clearance.

The defaults use Smiley Sans, translucent black (`--mg-surface:rgba(18,20,24,.74)`; code uses .78), mint, warm yellow and 18px corners. Text remains opaque. Override `--mg-paper`, `--mg-mint`, `--mg-yellow`, `--mg-surface` and `--mg-radius` in the host for a shared theme. Yellow marks a current step, explicit emphasis or correction; it does not alternate arbitrarily by row number. Metric and correction accents are 5px vertical lines inside the card padding; the correction strike is 6px.

## Content interface

Use each motion's `data.items` in `plan.json` for variable lists. An item is a string or `{label, description?, emphasis?}`. Descriptions belong to their row and may be omitted. Optional `title` is inside the card. The renderer converts `data` to `templateData`; legacy `copy` remains readable.

| Template | Additional data |
| --- | --- |
| ordered-steps | Optional title; numbered items with optional descriptions |
| parallel-points | Optional title / conclusion; default vertical, or `layout:"chips"` |
| linear-flow | Optional title / descriptions; horizontal or vertical; more than four items defaults to vertical |
| relation-map | `source`, items; default horizontal destinations or `layout:"vertical"` |
| converge-sources | Items and `result`; branches follow each input, then a downward collector reveals the result |
| map-transform | `source`, `result`; vertical or `layout:"horizontal"` |
| comparison | Optional title; items use label and optional description; horizontal or vertical |
| metric-proof | `source?`, `value`, `unit?`, `caption?`; long values and units can wrap |
| evidence-focus | Local `assets/` image, alt text, focus array of rectangles measured against the actual image. Keep highlights anchored during entry; pan the image and highlights together. |
| quote | `text`, optional `credit`; no mandatory attribution or fixed rule height |
| code-snippet | Optional title, items; `highlightIndex` or item emphasis |
| correction | `old`, `replacement` |
| annotation | Items; each piece has its own reveal, one piece may enter directly |

For legacy ordered-step copy, adjacent strings are label / description pairs. Other legacy lists retain their previous order. Prefer structured items for new plans; omit `copy` when structured fields already hold the content.

Example: a centered five-step card, with title followed by spoken step cues:

```json
{
  "id": "mg-01",
  "template": "ordered-steps",
  "start": 8,
  "end": 16,
  "revealAt": [8, 8.5, 9.8, 11.2, 12.7, 14.1],
  "data": {
    "title": "完整生产流程",
    "items": ["初始化", "文案", "生图", "音频", "成片"]
  }
}
```

## Timing and assembly

Choose the template and content in `plan.json`, then run the Skill's `scripts/compose.mjs`. Do not hand-edit generated HTML to change a count.

From the first composition, bind multi-element reveals to [spoken keywords](../../references/chatcut.md#read-and-lock-timing). `revealAt` contains absolute seconds on the locked edit; the composer converts it to each relative `data-at` slot. Connectors use the corresponding element's cue, never a fixed lead offset. Background cards appear at their final width and height from the first frame and stay that size throughout the MG. Only internal content and connectors reveal. Previous content remains available, sequential markers advance, and the composer owns the exit fade.

Slot order follows the DOM: optional heading then each list row; parallel conclusion last; relation source then destinations; convergence inputs then result; comparison heading then each side's label / description; metric optional source then value-and-unit together then optional caption; quote rule then text then optional credit; correction old text then strike then replacement; evidence each region; annotation each piece. Decorative slots can enter at the group start or use a deliberate absolute time. Recompute timings when adding or removing content. Example times demonstrate the format, not fixed intervals.

## Preview and stage helpers

For template development, `node dev/template-preview.mjs` creates a scrubbable gallery in this directory's ignored `renders/current/index.html`. `--serve` opens a local server; `--verify` checks browser geometry and backward seeking on machines with the HyperFrames Chrome cache. This developer tool is not part of normal video production. The striped background and evidence screenshot are fictional demonstrations.

Stage helpers [b-axis-horizon-grid](stage/b-axis-horizon-grid/) and [axis-stage-transition](stage/axis-stage-transition/) retain full-frame geometry. Add the horizon grid and matching transition as separate motions covering the same B-axis interval; the composer runs the transition on the shared timeline. These are optional treatments.

Use custom MGs when a real content relationship or explicit design request cannot be expressed here, with a brief reason in the plan summary. Keep job-specific modules inside the job.
