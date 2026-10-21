# Motion Graphics templates

17 reusable content templates for a 1080×1920 talking-head video, one redaction overlay, plus two stage helpers. Choose by meaning, then supply content and spoken anchors. Counts in template demonstrations are not limits.

## Coverage and selection

| Scene category | Count | Template | Use |
| --- | ---: | --- | --- |
| Sequence / process | 2 | [ordered-steps](ordered-steps/), [linear-flow](linear-flow/) | Numbered actions or connected input → processing → output |
| Independent points | 1 | [parallel-points](parallel-points/) | Features, conditions, resources; optional final conclusion |
| Relationships / conversion | 3 | [relation-map](relation-map/), [converge-sources](converge-sources/), [map-transform](map-transform/) | One → many, many → one, one → one respectively |
| Comparison / correction | 3 | [comparison](comparison/), [comparison-table](comparison-table/), [correction](correction/) | Alternatives, aligned table rows, or old wording → strike → replacement |
| Measured result | 3 | [metric-proof](metric-proof/), [metric-grid](metric-grid/), [growth-trend](growth-trend/) | One result, several aligned metrics, or an actual numerical trend |
| Variations | 1 | [factor-expansion](factor-expansion/) | Preserve a validated structure, vary several factors, then reveal the candidate pool |
| Evidence | 1 | [evidence-focus](evidence-focus/) | One or more regions of a real screenshot |
| Statement / quotation | 1 | [quote](quote/) | Statement with optional attribution |
| Technical instruction | 1 | [code-snippet](code-snippet/) | Commands or code with a selected emphasis |
| Supplementary note | 1 | [annotation](annotation/) | One short note or separately timed pieces |
| Redaction overlay | 1 | [redaction-mask](redaction-mask/) | Fixed gray coverage over avatars or link lines, with independent fade windows |

The 17 types cover ordinary talking-head explanations. Complex charts and multilevel graphs may need a custom MG; a different item count alone does not.

Choose the relationship before styling. For “文案、画面、音频、剪辑，全部用豆包完成”, use `converge-sources` with four `items` and `result:"豆包"`: each input follows its spoken word, then the collector leads downward to the named result. A parallel card with “豆包” in its initial title would expose that result early. Only a neutral organizational heading may enter at group start; a spoken tool, number, comparison or outcome keeps its own keyword cue even when displayed as a heading.

## Shared design

Content MGs start at `topPx:280`. The overall MG and background card are horizontally centered, including narrow vertical lists. Internal rows may align left; headings stay inside their card. Ordered steps, vertical linear flows and quotations default to 720px wide; `widthPx` can set a centered width, capped at 88% of the canvas. Fit tall cards above captions by choosing a compact layout, moving the whole card upward or splitting a dense beat; eyes and mouth do not need clearance.

The shared `theme.css` uses Smiley Sans, a translucent blue-black panel (`--mg-surface:rgba(20,31,50,.76)`), blue structural nodes, mint results and warm yellow data emphasis. Fine borders and inset highlights separate panel, node and result without heavy shadows. Default corners are 32px; labels, values and results have distinct type scales. Override `--mg-paper`, `--mg-muted`, `--mg-blue`, `--mg-mint`, `--mg-yellow`, `--mg-surface`, `--mg-line`, `--mg-node` and `--mg-radius` on a host ancestor; internal `--mg-c-*` aliases preserve inheritance.

Compared with the former flat black/text layouts, this design gives information a stable container and a clear hierarchy. Fixed SVG icon boxes, shared row baselines and connectors measured in untransformed layout pixels keep diagrams aligned. Motion explains source → relationship → outcome; it does not resize the panel or use constant zooming. Quotes, evidence and short notes stay restrained rather than imitating a dashboard.

## Content interface

Use `templateData.items` for variable lists. An item is a string or `{label, description?, emphasis?, icon?}`. Descriptions belong to their row and may be omitted. Optional `title` is inside the card. Legacy `copy` remains readable; component metadata calls its old example count `legacyCopySlots`.

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
| metric-grid | Optional title; items `{label,value,unit?,note?,emphasis?}`. One aligned label/value row per cue; an emphasized row enlarges label and data proportionally |
| comparison-table | Optional title, 2–3 `headers`, `rows:[{values:[...],emphasis?,reveal?:"cells"}]`. Headers and normal rows reveal together; `reveal:"cells"` reveals that row left to right |
| factor-expansion | `source`, `structure`, items `{label,value,icon?}`, `result`. No inferred combination count; supply the actual result wording |
| growth-trend | Optional title, items `{label,value:number}`, `result`. Nonnegative finite values determine actual bar height and line position; use only genuinely comparable measurements |
| evidence-focus | Local `assets/` image, alt text, focus array of rectangles measured against the actual image. Keep highlights anchored during entry; pan the image and highlights together. |
| quote | `text`, optional `credit`; no mandatory attribution or fixed rule height |
| code-snippet | Optional title, items; `highlightIndex` or item emphasis |
| correction | `old`, `replacement` |
| annotation | Items; each piece has its own reveal, one piece may enter directly |
| redaction-mask | `frame?`, `coordinateSize?`, `color?`, `opacity?`, `masks:[{id?,rects:[{x,y,width,height,radius?}],windows?,color?,opacity?}]`; overlay coordinates and timing are independent of caption copy |

`icon` selects a vetted 32×32 SVG from `scripts/mg-template-icons.mjs`; omission infers a suitable icon from the label. Icons are decoration within the row cue, not extra reveal slots.

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

New templates use these slots: metric-grid title then each complete row; comparison-table title, the complete header row, each ordinary row, then each cell of a cell-revealed row; factor-expansion source, preserved structure, factors, result; growth-trend title, each measured point, result.

For content MGs, a negative `exitAnchorOffsetFrames` moves the exit earlier within a long transcript unit; the exit still follows the beat start and its last meaningful reveal. Positive offsets retain the existing 12-frame limit.

Slot order follows the DOM: optional heading then each list row; parallel conclusion last; relation source then destinations; convergence inputs then result; comparison heading then each side's label followed by its description parts in array order; metric optional source then value-and-unit together then optional caption; quote rule then text then optional credit; correction old text then strike then replacement; evidence each region; annotation each piece. A neutral heading or decorative slot may use `atStart` or an explicit `after` cue. Spoken entities and outcomes use their own measured keyword; their position in a title does not turn them into decoration. Recompute bindings when adding or removing content.

## Gray redaction overlay

`redaction-mask` preserves the production gray (`#2b2a2c`) and linear fade, without blur, card styling or position animation. Its explicit beat interval and mask windows own the coverage; speech anchors and the shared MG exit fade do not shorten or fade that coverage. Several rectangles may form one mask group, and each group may appear more than once. The default opacity is 1; set a lower value only when incomplete coverage is intended.

`frame` places the overlay frame in its host (default 1080×1920 at 0,0). `coordinateSize` defines the source-coordinate basis for rectangles and defaults to the frame dimensions. Rectangles scale with that frame. An avatar can use a circular radius; separate thin rectangles can cover only the URL portions while preserving surrounding instructions. Keep the mask and footage in the same transformed container when their positions must move together; this template does not track moving content automatically.

Every `windows` entry is `[fadeInStart, fullyCovered, fadeOutStart, fullyClear]`, in seconds relative to the beat. Windows must be ordered, nonoverlapping and inside the beat. Place `fullyCovered` before the sensitive pixels become visible, and finish fading out before the source page disappears. Typical fades are 0.03–0.13 seconds. If windows are omitted, coverage spans the beat with up to 0.1-second fades. There are no spoken-copy or `data-at` slots; a single group's rectangles fade together.

```json
{
  "templateId": "redaction-mask",
  "templateData": {
    "frame": {"x": 100, "y": 420, "width": 880, "height": 760},
    "coordinateSize": {"width": 880, "height": 760},
    "masks": [{
      "id": "avatar",
      "rects": [{"x": 24, "y": 672, "width": 36, "height": 36, "radius": 18}],
      "windows": [[0.9, 1.0, 3.9, 4.0]]
    }]
  }
}
```

## Preview and stage helpers

`node scripts/preview-mg-templates.mjs --verify --render` replaces `renders/` with the latest gallery in `renders/current/index.html` (ignored by Git), its local font/GSAP assets, PNG snapshots and one 8-second MP4 for every content template and stage helper. Each gallery card has a video player plus an interactive HTML preview. Keep only this latest set. `--verify` checks real browser placement, early visibility, complete reveals and backward seeking, including longer / variable-count examples. The neutral background, evidence image and redaction chat interface are fictional demonstrations. Use `--template redaction-mask --verify --render` to add or update only that preview without re-rendering the existing set. Without `--render`, the command builds the interactive previews only; without `--verify`, it skips browser verification.

Stage helpers [b-axis-horizon-grid](stage/b-axis-horizon-grid/) and [axis-stage-transition](stage/axis-stage-transition/) retain full-frame geometry. Use the transition in the shared composition timeline, with B-axis intervals at least twice its duration and no overlap on the speaker track.

Use custom MGs when a real content relationship or explicit design request cannot be expressed here, with a brief reason in the Motion Plan. Keep experimental designs in the active job until their reusable content and timing interface is ready.
