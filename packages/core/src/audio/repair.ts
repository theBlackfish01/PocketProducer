import { protectedTrackHash, validateComposition, type Composition } from "../domain/composition.js";
import { simplifyDrums } from "../music/compiler.js";

export async function attemptBoundedDrumRepair<T>(input: {
  composition: Composition;
  render: T;
  renderCandidate(composition: Composition): Promise<T>;
  validateCandidate(composition: Composition, render: T): boolean;
}): Promise<{ composition: Composition; render: T; removed: number; rejectedError?: string }> {
  const protectedMelody = protectedTrackHash(input.composition, "melody");
  const simplified = simplifyDrums(input.composition);
  if (simplified.removed === 0) return { composition: input.composition, render: input.render, removed: 0 };
  try {
    const candidate = validateComposition(simplified.composition);
    const candidateRender = await input.renderCandidate(candidate);
    if (protectedTrackHash(candidate, "melody") !== protectedMelody || !input.validateCandidate(candidate, candidateRender)) {
      throw new Error("Bounded repair failed deterministic signal or melody-lock validation");
    }
    return { composition: candidate, render: candidateRender, removed: simplified.removed };
  } catch (error) {
    return { composition: input.composition, render: input.render, removed: 0, rejectedError: error instanceof Error ? error.message : "Bounded repair failed" };
  }
}
