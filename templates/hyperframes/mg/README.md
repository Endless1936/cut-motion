Each motion-graphics Beat owns one directory named after its Beat ID:

```text
mg/<beat-id>/
├── fragment.html
├── style.css
└── timeline.mjs
```

`fragment.html` contains exactly one root with `data-beat-id="<beat-id>"`.
`style.css` is scoped to that root. `timeline.mjs` is a deterministic snippet
that receives `timeline`, `beat`, `root`, and `select`; it must append motion
to the supplied timeline and must not create or register another timeline.
Tween targets must use `root`, `select("...")`, `root.querySelector(All)`, or
a literal selector beginning with the exact Beat root. The builder applies the
root exit using `beat.exitStartTime`, `beat.exitAnchorTime`, and
`beat.exitDuration`.
