Each motion-graphics Beat owns one directory named after its Beat ID:

```text
mg/<beat-id>/
├── fragment.html
├── style.css
└── timeline.mjs
```

Beat IDs match `^[a-z0-9][a-z0-9-]*$`. `fragment.html` contains exactly
one root with `data-beat-id="<beat-id>"`; do not author the reserved
`id="mg-<beat-id>"`, which belongs to the generated wrapper.
The builder wraps `style.css` in `@scope (#mg-<beat-id>)`; shared at-rules and
declarations belong in `index.template.html`. `timeline.mjs` receives
`timeline`, `beat`, `root`, and `select`. It is trusted Agent-authored code:
tween only `root` or `select("...")`, do not access global or parent DOM, and
do not create a separate timeline. The builder rejects imports and explicit
second timelines but deliberately does not maintain a JavaScript parser.
The builder applies the root exit using
`beat.exitStartTime`, `beat.exitAnchorTime`, and `beat.exitDuration`.

Use this lifecycle baseline:

```css
[data-beat-id="<beat-id>"] {
  opacity: 0;
  visibility: hidden;
}
```

```js
timeline.set(root, { autoAlpha: 1 }, beat.start);
```

The module owns its entrance and internal motion; the builder owns the final
root exit.
