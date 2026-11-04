import { expect, it } from "vitest";
import { isPlaybackHelp, qualitativeIdentity, requireMusicalDirection } from "./request-help.js";

it.each(["how can i hear it", "How do I listen to the arrangement?", "Where can I play this?", "How do I open it in Audiotool?"])("recognizes standalone playback help: %s", (text) => {
  expect(isPlaybackHelp(text)).toBe(true);
  expect(() => requireMusicalDirection(text)).toThrow(expect.objectContaining({ code: "PLAYBACK_HELP", statusCode: 422 }));
});
it.each(["Make the bass warmer. How can I hear it?", "How can I hear it more clearly?", "Play the melody an octave higher", "Add a new phrase then open Audiotool"])("keeps musical and mixed requests eligible: %s", (text) => {
  expect(isPlaybackHelp(text)).toBe(false);
  expect(() => requireMusicalDirection(text)).not.toThrow();
});
it("does not mistake exact protection for flexible identity", () => {
  expect(qualitativeIdentity("keep the theme recognizable")).toBe(true);
  for (const text of ["keep the recognizable theme unchanged", "retain musical identity without changing the notes", "keep the same notes so it is recognizable", "keep recognizable theme as written"]) expect(qualitativeIdentity(text)).toBe(false);
});
