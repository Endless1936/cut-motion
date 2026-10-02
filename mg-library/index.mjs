/**
 * MG component registry.
 *
 * `resolveComponent(recipeOrName)` lets a Beat Map request a component either
 * by component name or by the recipe alias it already carries, so existing beat
 * maps keep working without edits.
 */
import { TEXT_BLOCK_NAMES, textBlockComponent } from "./text-blocks.mjs";
import * as strikeout from "./strikeout.mjs";
import * as convergence from "./convergence.mjs";
import * as mapping from "./mapping.mjs";

const DIRECT = new Map([
  ["strikeout", strikeout],
  ["convergence", convergence],
  ["mapping", mapping],
  ...TEXT_BLOCK_NAMES.map((name) => [name, textBlockComponent(name)])
]);

/** Recipe names already used by hand-authored Beat Maps, mapped to components. */
const RECIPE_ALIASES = new Map([
  ["tool-strikeout", "strikeout"],
  ["strike-reveal", "strikeout"],
  ["strike-lock", "strikeout"],
  ["dependency-strikeout", "strikeout"],
  ["convergence-build", "convergence"],
  ["four-source-convergence", "convergence"],
  ["vertical-build", "mapping"],
  ["link-build", "mapping"],
  ["tool-to-output-link", "mapping"],
  ["list-build", "list-unordered"],
  ["ordered-list", "list-ordered"],
  ["quote-reveal", "quote"],
  ["code-build", "code-block"],
  ["title-reveal", "heading"]
]);

export const componentNames = () => [...DIRECT.keys()].sort();

export const describeComponents = () => [...DIRECT.entries()]
  .map(([name, component]) => ({ name, ...component.meta }))
  .sort((left, right) => left.name.localeCompare(right.name));

export const resolveComponent = (reference) => {
  if (!reference) return null;
  const name = RECIPE_ALIASES.get(reference) ?? reference;
  return DIRECT.get(name) ?? null;
};

export const componentFor = (beat) => {
  const explicit = resolveComponent(beat.mgComponent);
  if (explicit) return { component: explicit, requested: beat.mgComponent, via: "mgComponent" };
  if (beat.mgScope !== "local") return { component: null, requested: null, via: null };
  const byRecipe = resolveComponent(beat.recipe);
  if (byRecipe) return { component: byRecipe, requested: beat.recipe, via: "recipe" };
  throw new Error(`${beat.id}: no MG component matches recipe "${beat.recipe ?? ""}"; set mgComponent explicitly`);
};
