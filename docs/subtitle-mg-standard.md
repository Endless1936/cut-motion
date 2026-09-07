# Subtitle-Mode MG Standard

This standard applies when `captionMode` is `subtitles`. Captions carry the complete spoken wording; MG is an editorial annotation layer, not a second script.

## Core rule

Add MG only when it closes a viewer cognition gap by improving comprehension, credibility, calibration, organization, or action. New information alone is insufficient: its benefit must exceed the attention, reading, and credibility cost it introduces.

If removing an MG causes no specific loss beyond “the frame is less lively,” remove it.

## Layer ownership

| Layer | Primary responsibility |
| --- | --- |
| Voice | Claim, argument, tone, and personality |
| Captions | Complete accessible wording |
| Talking head or evidence footage | Human credibility, performance, and observable proof |
| MG | A relationship, proof, scale, structure, consequence, or action aid that the other layers do not already supply |

The talking head remains useful visual information. Do not replace it merely to create activity.

## Valid cognition gaps

Every local MG must answer one current viewer question and declare one `supportRole`:

| `supportRole` | Viewer question | Preferred treatment |
| --- | --- | --- |
| `evidence` | “Can I verify this?” | Real report, interface, source, or clearly labelled reconstruction |
| `explanation` | “Why or how does this happen?” | Causal chain, system map, or state change |
| `calibration` | “Is this large, small, normal, or exceptional?” | Baseline, range, benchmark, or controlled comparison |
| `organization` | “How do these ideas relate?” | Grouping, sequence, hierarchy, or progress map |
| `action` | “What should I do or choose?” | Decision aid, checklist, or next step |
| `consequence` | “What changes if this is true?” | Before/after state or result simulation |

Data, mechanism diagrams, comparisons, and decision trees are visual tools inside these roles; they are not independent reasons to add MG.

## Selection priority

Prefer, in order:

1. verifiable evidence;
2. relationships that are difficult to understand from speech alone;
3. immediately usable decisions or checks;
4. scale and context;
5. a compact memory anchor;
6. decorative stimulation.

Decorative motion may support an approved MG but cannot justify one.

## Planning contract

Each subtitle-mode beat with `mgScope: "local"` must record:

- `captionCueIds`: the exact approved single-line caption cues that create the node;
- `onScreenCopy`: the exact, exhaustive strings that may render in the MG;
- `visualStyle`: the concrete visual metaphor and motion family proposed for review;
- `semanticTopology`: the relationship being encoded, such as sequence, convergence, branch, comparison, or mapping;
- `entryAnchorWordId`: the aligned spoken word that triggers the first meaningful visual event;
- `primaryFlowAxis`: one horizontal or vertical main chain;
- `visualReference`: the approved sample/component being inherited, or a clearly named new proposal;
- `viewerQuestion`: the question created by the current spoken passage;
- `supportRole`: one role from the table above;
- `removalLoss`: what the viewer would specifically lose if the MG were removed;
- `visualEncoding`: the relationship, evidence, or state encoded by the picture;
- `stillFrameValue`: what remains understandable when motion is paused for one second;
- `attentionCost`: `low`, `medium`, or `high`;
- `evidenceSource` when `supportRole` is `evidence`;
- `factualClaims`: every factual addition with its traceable source, or an empty array;
- `terms`: every introduced technical term or formula with a plain-language explanation, or an empty array;
- `attentionCostReason` for a high-cost B-axis scene.

Caption-only beats do not need these fields.

Before implementation, `docs/caption-plan.md` must show every caption cue and every local MG mapping. The creative confirmation package must also list the ranges that intentionally receive no MG. Do not optimize toward a target count or cadence: select semantic nodes first, then design motion only inside the approved nodes.

`onScreenCopy` is the render contract. Viewer questions, rationale, caveats, removal loss, source notes, and phrases such as “经验档位” or “这里需要说明” are production metadata and must never leak into the frame. Prefer nouns, numbers, and relationship labels; captions already carry complete sentences.

## Lowest-cost visual rule

Use the least demanding form that closes the gap:

- no cognition gap: caption and talking head only;
- one fact or status: short A-axis annotation;
- one relation or short sequence: A-axis diagram;
- three or more dependent elements, a system, or a decision structure: coherent B-axis scene;
- factual proof: real evidence asset before an invented card.

Do not introduce a technical term, formula, or benchmark that creates more unanswered questions than it resolves. A high-attention-cost MG is valid only on the B-axis with a documented reason; otherwise simplify or delete it.

## Timing and information behavior

- Trigger MG at a semantic boundary or when the viewer question arises, not on a fixed “visual change every N seconds” timer.
- Start the first meaningful event within the design-system delay limit, and reveal a connector with its destination container within the shared frame tolerance.
- Treat MG as punctuation, not a continuous layer. In a typical subtitle-mode talking-head video, most runtime should remain talking head plus captions.
- One MG passage performs one cognitive job.
- In A-axis overlay mode, use replacement cadence: a local information group normally remains for 1.8–3.0 seconds, exits completely, and is then replaced. Do not retain earlier cards while a later idea arrives.
- Prefer a face-safe zone. A meaningful group may briefly cover the face for up to about three seconds, but never accumulates with the next group.
- Declare one horizontal or vertical primary flow. Do not turn the main chain 90 degrees; branch on the secondary axis only at a terminal node.
- Reuse the approved visual reference for copy, timing, or size-only changes.
- Bind supporting material to the exact spoken clause, including its exit anchor and exit animation. Size/crop for the current evidence; use [the revision standard](revision-standard.md#evidence-layout-and-timing) for portrait material, prior-video proof, and in-place spotlight zoom.
- Repeating a complete visual signature requires an explicit reuse group and semantic reason.
- In B-axis stage mode, dependent elements may accumulate within one coherent page and exit together when that page resolves.
- Reveal components in causal or reading order, then hold the resolved state long enough to inspect.
- Keep labels adjacent to the element they describe; avoid detached legends and visual search.
- Prefer persistent end states over fleeting symbols.
- Do not add a simultaneous reading task during the densest caption phrase.
- Use motion to expose change, dependency, comparison, or hierarchy. If a static state communicates equally well, keep the motion restrained.

## Evidence and claims

- A factual addition needs a traceable source in the project research record.
- Platform promises, simulated interfaces, reconstructed reports, and estimates must be labelled as such.
- Do not generalize from one price, device, benchmark, or anecdote.
- Show the assumption and important omitted cost for estimates.
- Never use juxtaposition, scale, or animation to imply a stronger conclusion than the evidence supports.

## Review tests

Every proposed MG must pass:

1. **Gap test:** it answers a natural question created by the current passage.
2. **Removal test:** `removalLoss` names a concrete comprehension, evidence, calibration, organization, or action loss.
3. **Still-frame test:** a one-second pause reveals a relationship, proof, or structure—not another version of the caption.
4. **Cost test:** its benefit exceeds visual reading, attention switching, and credibility cost.
5. **Source test:** every new factual claim is traceable or explicitly framed as an estimate.

## Blocking failures

- caption paraphrase presented as a headline;
- novelty unrelated to the current viewer question;
- text-heavy MG competing with active captions;
- an unexplained technical term or formula;
- evidence represented by an unlabeled invented interface;
- a complex A-axis overlay that should be a B-axis scene;
- a fixed-cadence pattern interrupt with no semantic purpose;
- A-axis information groups accumulated into a page instead of being replaced;
- a transient graphic whose resolved meaning never remains visible;
- any overlap with captions, PiP, evidence, or protected UI, or prolonged face coverage without a recorded user instruction, or accumulated face coverage;
- an MG that cannot state a concrete `removalLoss`.
