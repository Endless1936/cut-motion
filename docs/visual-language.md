# Gold-Standard Visual Language

The repository uses mode-specific references rather than one fixed template:

- `examples/traework-reference/` is the preferred reference for `captionMode: subtitles`: independent captions, localized supplemental MG, evidence-first composition, and selective B-axis staging.
- `examples/gold-standard/` is the legacy runnable reference for `captionMode: motion-copy`: spoken wording is designed into the animation without a separate caption layer.

Both references provide motion grammar, not reusable coordinates, copy, assets, or timecodes.

## What made the final reference work

The successful version did not come from one fixed animation template. It came from a coherent motion grammar applied sentence by sentence:

- the talking-head video remained the primary photographic background;
- full B-axis scenes were reserved for moments that needed a visual stage;
- in `motion-copy`, typography became the effect instead of sitting in a subtitle band; in `subtitles`, captions stayed separate and MG supplied only missing relationships or proof;
- components were large enough to command the frame and could cover the face;
- GSAP provided controlled depth, stagger, elasticity, and accumulation;
- colors stayed lively but softened by warm neutrals and restrained shadows;
- later revisions were synchronized to phrase-level audio rather than rough scene timing.

## Motion grammar

Use three coordinated families across one video:

1. **Editorial kinetic type** — bold Chinese typography, stamps, strike-throughs, counters, and incremental copy.
2. **Soft technical interface** — timelines, modules, progress, tool cards, and live indicators.
3. **Celebratory spectacle** — fireworks, confetti, supporter lights, and rhythmic finales.

Vary the family by meaning. Keep typography, corner treatment, shadow logic, and easing consistent enough that the video still feels like one system.

## Surface treatment

- Prefer clean footage plus localized panels.
- Use glass only on bounded components and only when the background remains readable.
- Use one dominant accent and one supporting accent per scene.
- Keep shadows broad and low-contrast; avoid hard black drop shadows everywhere.
- Add blur or texture locally, never as a permanent full-frame dirt layer.

## Typography

- Use 得意黑 as the default Chinese display face and embed it locally through `@font-face`. A job may change fonts only because of a confirmed brand requirement.
- Captions inherit the design-system weight, normally `400`; do not synthesize bold or copy a legacy sample's heavier weight.
- Make primary phrases large; this video format prioritizes motion over an unobstructed face.
- Maintain readable line height and safe padding around transformed glyphs.
- Do not clip ascenders, descenders, outlines, or shadows.
- Keep essential wording in Chinese. English is secondary flavor.

For a 1080×1920 vertical composition:

- primary display copy: 84–156 px;
- secondary copy: 42–72 px;
- display line height: 0.92–1.12;
- outlined-glyph reserve: at least 18 px;
- panel padding: 48–72 px.

Do not reduce primary copy below these ranges to rescue a bad layout. Recompose the scene.

## Density and rhythm

- In `motion-copy`, active speech should produce a meaningful visual response every 0.35–0.9 seconds. In `subtitles`, this cadence applies only inside approved local MG.
- Major layout changes should normally be 1.8–3.5 seconds apart.
- One primary focal group plus one to four support elements is the default density.
- Primary content normally occupies 28–65% of vertical frame area.
- A scene may breathe, but a large empty panel, unlabeled shape, or blank module is not breathing space.
- Density must change over time: entrance, build, hold, and release should not all carry the same visual weight.
- Every visible label must add new spoken meaning, a necessary state, or a value needed to interpret the scene. Decorative English headers, fake timecodes, redundant numbering, and labels that name self-evident elements such as “真人画面” are render blockers.

## Spatial logic

- Keep primary copy away from the extreme top edge; the top strip is reserved for small metadata and status marks.
- Maintain at least 54 px side clearance and 88 px top and bottom clearance.
- Place the main focal group between 22% and 78% of frame height unless an intentional off-canvas move is documented.
- Test the bounding box at maximum GSAP overshoot, rotation, outline, and shadow—not only at the resting frame.
- When text accumulates, preserve a stable anchor and expand into available space. Do not compress previous clauses into unreadable corners.
- When a layout becomes crowded, remove decoration or redesign grouping before reducing text size.

## Composition rules

- Empty colored shapes are not content. Add a meaningful icon, status, label, diagram, or animation.
- Incremental sentences retain earlier clauses until the semantic unit completes.
- Each MG has one horizontal or vertical primary flow; do not turn the main chain 90 degrees.
- Copy, timing, and size-only revisions inherit their approved sample or component.
- Generic outer frames and black container outlines are forbidden; connectors inherit the design-system connector token.
- Repeating the same layout, topology, entry, and motion family requires an explicit semantic reuse reason.
- Strike-through copy should physically strike the named tool, not appear as a detached caption.
- Timeline playheads sit above tracks, use a thin line, and have a readable triangular head.
- Picture-in-picture footage must continue playing and must not become a still image.
- Finale particles may overlap the speaker but should not obscure the entire frame.

## Render-blocking anti-patterns

- full-frame dark or milky overlays that make footage dirty;
- every phrase using the same depth transition;
- rapid A/B-axis switching without semantic reason;
- tiny text pushed into the top edge;
- overlapping lines caused by insufficient line height;
- cards with no content;
- ornamental micro-labels that do not change interpretation;
- symbols that disappear before viewers can identify them;
- subtitles duplicated below motion copy;
- frozen loops or PIP video before the audio ends;
- animation cues that visibly lag behind the spoken phrase.
