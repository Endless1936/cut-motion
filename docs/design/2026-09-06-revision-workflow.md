# Revision workflow fixes

This conversation exposed execution gaps as well as missing tooling. The existing standards already required semantic anchors, A-axis overlays, useful evidence, and content-sized layouts; repeating those promises did not repair the rendered video.

| Observed problem | Change |
| --- | --- |
| A tall image reused a wide empty plate; other proof was cropped too tightly | Size by source shape and evidence needs; retain source context and honor permitted face coverage |
| A phrase-specific image persisted into later speech | Check resolved word anchors and exit motion, including the first frame after exit; inspect every use of the same faulty pattern |
| A spotlight reference became a second panel; cover reveals acquired unnecessary shuffling | Specify the relationship/choreography being borrowed and adapt it inside the current display area |
| Caption edits and late cuts depended on ad hoc scripts | Enforce half-open caption windows during install/build; resolve blank times from words; produce safe frame-aware cut candidates |
| Delivery was correct while the editable parent and workflow state could remain behind | Make the active delivery, parent composition, and any final edit map explicit; reconcile state rather than implying all artifacts share the new timeline |

Implementation stays inside the existing fast path. Visual checks are limited to reported defects. Timing tests cover boundary behavior and failure cases; they do not score aesthetics. Current job media and accepted creative choices are not changed by this repository revision.
