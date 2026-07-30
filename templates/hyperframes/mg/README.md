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
`style.css` is scoped to that root and cannot use at-rules; shared declarations
belong in `index.template.html`. `timeline.mjs` is a deterministic snippet that
receives `timeline`, `beat`, `root`, and `select`; it must append motion to the
supplied timeline and must not create or register another timeline. Tween
targets must use `root`, `select("...")`, `root.querySelector(All)`, or a
literal selector whose result remains inside the exact Beat root. The builder
applies the root exit using `beat.exitStartTime`, `beat.exitAnchorTime`, and
`beat.exitDuration`.

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
