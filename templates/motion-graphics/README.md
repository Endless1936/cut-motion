# Motion Graphics templates

13 reusable content templates for a 1080×1920 talking-head video, plus two stage helpers. Choose by meaning, then supply content and spoken anchors. Counts in template demonstrations are not limits.

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

Choose the relationship before styling. For “文案、画面、音频、剪辑，全部用豆包完成”, use `converge-sources` with four `items` and `result:"豆包"`: each input follows its spoken word, then the collector leads downward to the named result. A parallel card with “豆包” in its initial title would expose that result early. Only a neutral organizational heading may enter at group start; a spoken tool, number, comparison or outcome keeps its own keyword cue even when displayed as a heading.

## Shared design

Content MGs start at `topPx:280`. The overall MG and background card are horizontally centered, including narrow vertical lists. Internal rows may align left; headings stay inside their card. Ordered steps, vertical linear flows and quotations default to 720px wide; `widthPx` can set a centered width, capped at 88% of the canvas. Fit tall cards above captions by choosing a compact layout, moving the whole card upward or splitting a dense beat; eyes and mouth do not need clearance.

The defaults use Smiley Sans, translucent black (`--mg-surface:rgba(18,20,24,.74)`; code uses .78), mint, warm yellow and 18px corners. Text remains opaque. Override `--mg-paper`, `--mg-mint`, `--mg-yellow`, `--mg-surface` and `--mg-radius` in the host for a shared theme. Yellow marks a current step, explicit emphasis or correction; it does not alternate arbitrarily by row number. Metric and correction accents are 5px vertical lines inside the card padding; the correction strike is 6px.

## Content interface

Use `templateData.items` for variable lists. An item is a string or `{label, description?, emphasis?}`. Descriptions belong to their row and may be omitted. Optional `title` is inside the card. Legacy `copy` remains readable; component metadata calls its old example count `legacyCopySlots`.

| Template | Additional data |
| --- | --- |
| ordered-steps | Optional title; numbered items with optional descriptions |
| parallel-points | Optional title / conclusion; default vertical, or `layout:"chips"` |
| linear-flow | Optional title / descriptions; horizontal or vertical; more than four items defaults to vertical |
| relation-map | `source`, items; default horizontal destinations or `layout:"vertical"` |
| converge-sources | Items and `result`; one row for up to four inputs, otherwise deterministic three-column rows with the last row centered (five inputs: 3+2). Branches follow each input, then a downward collector reveals the result |
| map-transform | `source`, `result`; vertical or `layout:"horizontal"` |
| comparison | Optional title; items use label and optional description; a description array such as `["质感更好", "多花半分钟"]` gives each phrase an independent reveal. Horizontal or vertical |
| metric-proof | `source?`, `value`, `unit?`, `caption?`; long values and units can wrap |
| evidence-focus | Local `assets/` image, alt text, focus array of rectangles measured against the actual image. Keep highlights anchored during entry; pan the image and highlights together. |
| quote | `text`, optional `credit`; no mandatory attribution or fixed rule height |
| code-snippet | Optional title, items; `highlightIndex` or item emphasis |
| correction | `old`, `replacement` |
| annotation | Items; each piece has its own reveal, one piece may enter directly |

For legacy ordered-step copy, adjacent strings are label / description pairs. Other legacy lists retain their previous order. Prefer structured items for new plans. Plan generation derives exact `onScreenCopy`; do not maintain a conflicting duplicate.

Example: a centered five-step card, with title followed by spoken step cues:

```json
{
  "templateId": "ordered-steps",
  "templateData": {
    "title": "完整生产流程",
    "items": ["初始化", "文案", "生图", "音频", "成片"],
    "revealCues": [
      {"atStart": true},
      {"keyword": "初始化", "segmentId": "main-001"},
      {"keyword": "文案", "segmentId": "main-001"},
      {"keyword": "生图", "segmentId": "main-002"},
      {"keyword": "音频", "segmentId": "main-002"},
      {"keyword": "成片", "segmentId": "main-003"}
    ]
  }
}
```

## Timing and assembly

Choose the template and content in the existing Motion Plan, then run `scripts/compose-job.mjs`. Do not hand-edit generated HTML to change a count.

From the first composition, bind multi-element reveals to [spoken keywords](../../docs/mg-speech-timing.md). Each `data-at` slot is relative to the beat; supplied `revealTimes` or resolved `revealCues` replace demonstration spacing. Connectors use the corresponding element's cue, never a fixed lead offset. Background cards appear at their final width and height from the first frame and stay that size throughout the MG. Only internal content and connectors reveal; do not animate the card's height, width or clipping with the text. Previous content remains available, sequential markers advance, and the existing builder owns the exit anchor and fade. No extra approval, workflow state or blocking step is introduced.

Slot order follows the DOM: optional heading then each list row; parallel conclusion last; relation source then destinations; convergence inputs then result; comparison heading then each side's label followed by its description parts in array order; metric optional source then value-and-unit together then optional caption; quote rule then text then optional credit; correction old text then strike then replacement; evidence each region; annotation each piece. A neutral heading or decorative slot may use `atStart` or an explicit `after` cue. Spoken entities and outcomes use their own measured keyword; their position in a title does not turn them into decoration. Recompute bindings when adding or removing content.

## Preview and stage helpers

`node scripts/preview-mg-templates.mjs` replaces `renders/` with one lightweight, scrubbable gallery from current sources in `renders/current/index.html` (ignored by Git), including its local font and GSAP assets. Keep only this latest preview; do not accumulate old videos, galleries or temporary render files. `--verify` also checks actual browser geometry, early visibility, complete reveals and backward seeking for the 13 demonstrations and longer / variable-count variants. The striped background and evidence screenshot are fictional demonstrations. Do not present older rendered clips as current-source previews.

Stage helpers [b-axis-horizon-grid](stage/b-axis-horizon-grid/) and [axis-stage-transition](stage/axis-stage-transition/) retain full-frame geometry. Use the transition in the shared composition timeline, with B-axis intervals at least twice its duration and no overlap on the speaker track.

Use custom MGs when a real content relationship or explicit design request cannot be expressed here, with a brief reason in the Motion Plan. Keep experimental designs in the active job until their reusable content and timing interface is ready.
