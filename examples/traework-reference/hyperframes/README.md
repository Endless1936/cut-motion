# TraeWork source modules

This directory contains the reusable HyperFrames source extracted from the private TraeWork job. Each module is an authoring example with `fragment.html`, `style.css`, and `timeline.mjs`.

The modules are deliberately not a copy of the full job: project media, transcript, Beat Map, generated composition, logs, and render outputs stay under the ignored job directory. Their timings and copy are case-specific; reuse the structure, layout, evidence treatment, and seek-safe animation grammar, then bind them to the new job's Beat Map.

To reuse a module, copy its directory into a job's `hyperframes/mg/`, provide approved assets at the paths used by the fragment, and create the matching Beat Map entry. Run the normal composition builder before checking or rendering.
