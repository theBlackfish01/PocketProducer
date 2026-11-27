import { sceneOperations } from "./construction-tools.js";
import { applyNativeOperations } from "./model.js";
import { seedNativeDocument } from "./seed.js";
import type { Starter } from "./starters.js";

// Original reference melodies. The producer can load their notes without copying them into its prompt.
// Positions and lengths are in quarter notes, including the waltz.
type Event = [beat: number, length: number, pitch: number, velocity: number];
type Statement = { id: string; name: string; bars: number; at: number[]; events: Event[]; parent?: string; part?: string };
type Reference = {
  id: Starter["id"]; title: string; direction: string; bpm: number; beats: number;
  chords: string[]; landing: string; sections: [name: string, bars: number, energy: Starter["arc"][number], intent: string][];
  statements: Statement[]; countervoice?: { name: string; recipe: string };
};

export const starterReferences: Reference[] = [
  {
    id: "french-house-v1", title: "Mercury Arcade", bpm: 118, beats: 4,
    direction: "A clipped D-Dorian disco groove. A rising three-note pickup keeps interrupting the bass, disappears in the tunnel, then returns an octave higher over a second plucked voice.",
    chords: ["Dm9", "G13", "Fmaj7", "Am7"], landing: "Dm9",
    sections: [
      ["Shutters", 4, "open", "Let one unaccompanied pickup peek through the filtered stabs."],
      ["Arcade floor", 8, "pocket", "Alternate the skipping call with a low reply. Keep the first downbeat open."],
      ["Underpass", 4, "break", "Pull the kick and bass away. Stretch the pickup into a single hanging question."],
      ["Neon return", 6, "lift", "Bright octave answer on top. Short plucks occupy its rests."],
      ["Last token", 2, "close", "Bring the melody down to D and leave the final chord ringing."]
    ],
    countervoice: { name: "Token pluck", recipe: "pluck-arp" },
    statements: [
      { id: "coin", name: "Three coins", bars: 2, at: [2, 4, 8, 16], events: [[.75, .2, 69, .81], [1.25, .2, 72, .65], [1.75, .62, 74, .88], [3.5, .32, 72, .64], [4.75, .45, 71, .76], [5.5, .7, 69, .68], [7, .38, 67, .69]] },
      { id: "change", parent: "coin", name: "Change returned", bars: 2, at: [6, 10], events: [[.75, .2, 69, .79], [1.25, .2, 72, .68], [1.75, .65, 76, .82], [3, .38, 74, .72], [4.5, .8, 72, .73], [6.25, .35, 69, .63], [7.5, .25, 67, .59]] },
      { id: "tunnel", parent: "coin", name: "Signal through glass", bars: 2, at: [14], events: [[.75, .36, 69, .51], [1.75, 1.85, 74, .57], [6, .85, 71, .51]] },
      { id: "ceiling", parent: "coin", name: "Up an octave", bars: 2, at: [18, 20], events: [[.75, .2, 81, .75], [1.25, .2, 84, .67], [1.75, .9, 86, .82], [3.5, .3, 81, .66], [4.75, .4, 79, .74], [5.5, .68, 76, .72], [7, .45, 74, .68]] },
      { id: "tokens", part: "answer", name: "In the gaps", bars: 2, at: [16, 18, 20], events: [[.25, .16, 62, .61], [2.75, .16, 65, .53], [3.25, .17, 69, .65], [4.25, .16, 67, .56], [6.5, .18, 71, .58]] },
      { id: "last", parent: "coin", name: "Pocket change", bars: 2, at: [22], events: [[.75, .38, 69, .70], [1.75, .88, 65, .65], [3.5, .28, 64, .52], [4, 2.8, 62, .72]] }
    ]
  },
  {
    id: "broken-beat-v1", title: "Last Table", bpm: 86, beats: 4,
    direction: "An after-hours broken beat in E-flat. Put the bass on the front of the beat and let the keys answer late. A little falling tine melody leaves room for a second voice to finish its sentences.",
    chords: ["Ebmaj9", "Cm9", "Fm9", "Bb13"], landing: "Eb6/9",
    sections: [
      ["Chairs up", 2, "open", "Introduce the falling tine figure softly."],
      ["Back booth", 6, "pocket", "Let uneven kick gaps and behind-the-beat keys trade space."],
      ["Streetlight", 4, "break", "Hang a fragment over the empty bass register."],
      ["One more", 6, "lift", "Answer the original phrase from the left with a second voice."],
      ["Lights out", 2, "close", "Land on the tonic sixth/ninth without the kit."]
    ],
    countervoice: { name: "Left-hand reply", recipe: "soft-lead" },
    statements: [
      { id: "tine", name: "Falling thirds", bars: 2, at: [0, 4, 12, 16], events: [[.5625, .68, 79, .74], [1.625, .32, 75, .57], [2.5625, 1.18, 72, .71], [4.625, .48, 75, .67], [5.5625, .28, 74, .54], [6.125, 1.18, 70, .69]] },
      { id: "booth", parent: "tine", name: "Over the turnaround", bars: 2, at: [2, 6, 14], events: [[.5625, .68, 77, .73], [1.625, .32, 72, .55], [2.5625, 1.24, 68, .65], [4.625, .48, 74, .68], [5.5625, .28, 72, .54], [6.125, .9, 68, .63], [7.625, .22, 70, .49]] },
      { id: "window", parent: "tine", name: "Across the window", bars: 2, at: [10], events: [[1.625, 1.4, 72, .54], [4.625, 1.9, 74, .56]] },
      { id: "whisper", part: "answer", name: "Answer from the left", bars: 2, at: [12, 16], events: [[3.8125, .22, 63, .62], [4.0625, .32, 67, .55], [7.5625, .32, 63, .58]] },
      { id: "lights", parent: "tine", name: "Leave the ninth", bars: 2, at: [18], events: [[.5625, .64, 77, .69], [1.625, .33, 72, .57], [2.5625, .92, 68, .62], [4.0625, 2.5, 67, .65]] }
    ]
  },
  {
    id: "chamber-waltz-v1", title: "The Paper Observatory", bpm: 76, beats: 3,
    direction: "A drumless miniature in three. The glass melody measures a small staircase above strings, turns back on itself, then leaves its final note suspended above an A-minor chord.",
    chords: ["Amadd9", "Fmaj7", "C/G", "Esus4"], landing: "Amadd9",
    sections: [
      ["Fold", 4, "open", "A glass pickup appears out of a slowly opening string chord."],
      ["Stairs", 6, "pocket", "A four-note staircase alternates with its descending reflection."],
      ["Lens", 2, "break", "Take away the bass and allow one isolated high tone."],
      ["Constellation", 6, "lift", "Reach a higher summit before giving the figure back to its first register."],
      ["Paper sky", 2, "close", "Hold the fifth while the bass settles on A."]
    ],
    statements: [
      { id: "stair", name: "Four paper steps", bars: 2, at: [2, 4, 8, 16], events: [[.5, .65, 69, .60], [1.75, .78, 72, .66], [3, 1.2, 76, .73], [4.75, .8, 77, .64]] },
      { id: "mirror", parent: "stair", name: "Reflection", bars: 2, at: [6, 14], events: [[.5, .8, 79, .69], [1.75, .82, 76, .63], [3, 1.18, 74, .66], [4.75, .88, 71, .59]] },
      { id: "pin", parent: "stair", name: "One pin of light", bars: 2, at: [10], events: [[2.5, 2.3, 76, .52]] },
      { id: "zenith", parent: "stair", name: "Zenith", bars: 2, at: [12], events: [[.5, .66, 76, .65], [1.75, .78, 79, .69], [3, 1.48, 81, .76], [5, .63, 77, .62]] },
      { id: "settle", parent: "stair", name: "Paper sky", bars: 2, at: [18], events: [[.5, .67, 72, .64], [1.75, .82, 71, .58], [3, 2.6, 76, .64]] }
    ]
  },
  {
    id: "synthwave-v1", title: "Violet Overpass", bpm: 104, beats: 4,
    direction: "A night drive in F-sharp minor. A low eighth-note motor keeps running under a broad lead. Let it coast during the break, then answer the opening higher with a little arpeggio between its phrases.",
    chords: ["F#m9", "Dmaj7", "Aadd9", "E6"], landing: "F#m9",
    sections: [
      ["On-ramp", 2, "open", "Bring the call in before the bass motor catches."],
      ["Cruise", 6, "pocket", "Let the low eighths carry two alternating phrases."],
      ["Underpass", 4, "break", "Open a long gap beneath a descending echo."],
      ["Passing lights", 6, "lift", "Take the lead higher and answer its held notes with short plucks."],
      ["Daybreak", 2, "close", "Bring the answering voice back to F-sharp and hold the ninth underneath."]
    ],
    countervoice: { name: "Dash lights", recipe: "pluck-arp" },
    statements: [
      { id: "headlight", name: "Headlight call", bars: 2, at: [0, 4, 12], events: [[.5,.38,69,.70],[1,.65,73,.77],[2,1.4,76,.80],[3.75,.22,73,.57],[4.5,1.2,69,.73],[6,1.4,66,.65]] },
      { id: "merge", parent: "headlight", name: "Merge left", bars: 2, at: [2, 6], events: [[.5,.38,69,.72],[1,.72,73,.75],[2,1.25,76,.77],[3.5,.36,78,.67],[4.75,.62,76,.70],[5.75,1.6,71,.68]] },
      { id: "coast", parent: "headlight", name: "Coasting", bars: 2, at: [10], events: [[1,1.8,76,.49],[4.5,1.4,71,.49],[6.5,.75,68,.42]] },
      { id: "passing", parent: "headlight", name: "Passing lights", bars: 2, at: [14, 16], events: [[.5,.38,81,.72],[1,.68,85,.78],[2,1.45,83,.77],[4.25,.4,80,.64],[5,.70,78,.66],[6,1.65,76,.71]] },
      { id: "dash", part: "answer", name: "Dashboard flicker", bars: 2, at: [12, 14, 16], events: [[3.5,.15,61,.55],[3.75,.16,66,.50],[4,.2,69,.59],[7.5,.16,64,.56],[7.75,.16,68,.49]] },
      { id: "home", parent: "headlight", name: "Home stretch", bars: 2, at: [18], events: [[.5,.4,73,.65],[1.25,.6,71,.60],[2.5,1.1,69,.56],[4,2.8,66,.65]] }
    ]
  },
  {
    id: "bossa-nova-v1", title: "Patio Radio", bpm: 112, beats: 4,
    direction: "A small bossa in D. Keep the plucked chords nimble against the bass on one and three. Let the lead start just before the bar turns, leave a little silence, and answer the question lower.",
    chords: ["Dmaj9", "Bm7", "Em9", "A13"], landing: "D6/9",
    sections: [
      ["Open window", 2, "open", "Let the lead hang across the bar line."],
      ["Conversation", 4, "pocket", "Trade an upward question with a falling answer."],
      ["Breeze", 2, "break", "Give the bass a rest while one brief phrase floats above."],
      ["Across the patio", 6, "lift", "Move the melody up, then bring its answer back down over the offbeats."],
      ["Sign-off", 2, "close", "Anticipate the last chord, then let the tonic settle."]
    ],
    statements: [
      { id: "question", name: "Open question", bars: 2, at: [0, 4, 8], events: [[.75,.43,66,.66],[1.5,.45,69,.69],[2.25,.84,71,.72],[3.75,.86,73,.75],[5.25,.45,71,.61],[6,.84,69,.66]] },
      { id: "reply", parent: "question", name: "A lower reply", bars: 2, at: [2, 10], events: [[.75,.44,67,.67],[1.5,.50,71,.69],[2.5,.92,74,.74],[3.75,.9,73,.69],[5.25,.40,69,.63],[6,1.12,66,.64]] },
      { id: "breeze", parent: "question", name: "Across the sill", bars: 2, at: [6], events: [[2.25,1.1,71,.52],[3.75,1.25,69,.55],[6.25,.46,64,.45]] },
      { id: "upstairs", parent: "question", name: "Upstairs reply", bars: 2, at: [12], events: [[.75,.43,74,.66],[1.5,.45,78,.72],[2.25,.84,76,.74],[3.75,.92,73,.68],[5,.45,71,.63],[5.75,.55,69,.60],[6.75,.65,66,.64]] },
      { id: "goodnight", parent: "question", name: "Last word", bars: 2, at: [14], events: [[.75,.66,67,.61],[2,.64,69,.63],[3.5,.42,66,.52],[3.95,2.75,62,.64]] }
    ]
  },
  {
    id: "tidal-ambient-v1", title: "Tide Almanac", bpm: 66, beats: 4,
    direction: "A drumless coastal miniature in D. Let each chord arrive a note at a time, with a barely moving bass. A high bell gives two short signals and one long one, then leaves a whole stretch of water empty.",
    chords: ["Dadd9", "Asus4", "Bm7", "Gmaj7"], landing: "Dadd9",
    sections: [
      ["Low water", 2, "open", "Introduce three bell tones over a slowly opening chord."],
      ["Incoming", 4, "pocket", "Let the bell climb while the bass moves once per bar."],
      ["Slack tide", 4, "break", "Drop the bass, leave two bars of space, then hold one high signal."],
      ["High water", 4, "lift", "Broaden the answer and let it descend through the chord."],
      ["Soundings", 2, "close", "Return to the opening register and let the final D fade."]
    ],
    statements: [
      { id: "beacon", name: "Two short, one long", bars: 2, at: [0, 4], events: [[.75,.42,76,.59],[1.75,.51,78,.48],[3.5,2.5,81,.65],[6.75,.62,76,.43]] },
      { id: "current", parent: "beacon", name: "Incoming current", bars: 2, at: [2], events: [[.75,.48,74,.58],[1.75,.60,78,.54],[3.5,2.4,83,.62],[6.5,.87,81,.47]] },
      { id: "far", parent: "beacon", name: "Distant signal", bars: 2, at: [8], events: [[2.5,3.25,81,.43]] },
      { id: "crest", parent: "beacon", name: "Crest and answer", bars: 2, at: [10, 12], events: [[.75,.52,83,.65],[1.75,.67,81,.54],[3.25,1.6,78,.63],[5,.78,76,.50],[6.5,1,74,.57]] },
      { id: "ebb", parent: "beacon", name: "Last sounding", bars: 2, at: [14], events: [[.75,.66,78,.54],[2,.70,76,.47],[4,3.1,74,.56]] }
    ]
  }
];

export function referenceScene(ref: Reference, includeMelody = true) {
  let cursor = 0;
  const sections = ref.sections.map(([name, bars, , intent], i) => {
    const startBar = cursor;
    cursor += bars;
    return { id: `s${i + 1}`, name, startBar, endBar: cursor, intent };
  });
  const statements = includeMelody ? ref.statements : [];
  return {
    stepKey: "initial-arrangement", title: ref.title, structure: { bars: cursor, sections, tempoBpm: ref.bpm },
    starter: { id: ref.id, chords: ref.chords, arc: ref.sections.map(s => s[2]), landing: ref.landing, lead: true },
    parts: includeMelody && ref.countervoice ? [{ id: "answer", role: "texture", ...ref.countervoice, gain: .38, pan: ref.beats === 4 && ref.id === "broken-beat-v1" ? -.32 : .34 }] : [],
    patterns: statements.map(s => ({
      id: s.id, name: s.name, partId: s.part ?? "lead", lengthTicks: s.bars * ref.beats * 960,
      ...(s.parent ? { derivedFromMotifId: s.parent, familyId: s.parent } : {}),
      events: s.events.map(([beat, length, pitch, velocity]) => [Math.round(beat * 960), Math.round(length * 960), pitch, velocity])
    })),
    placements: statements.flatMap(s => s.at.map(bar => ({ partId: s.part ?? "lead", placement: { id: `${s.id}-${bar}`, motifId: s.id, startTick: bar * ref.beats * 960, repeats: 1, transpose: 0 } })))
  };
}

export function buildReference(ref: Reference, includeMelody = true) {
  const seed = seedNativeDocument(ref.direction);
  return applyNativeOperations(seed, sceneOperations(referenceScene(ref, includeMelody), seed));
}

export function getTemplateReference(id: Starter["id"]) {
  const reference = starterReferences.find(item => item.id === id);
  if (!reference) throw new Error("Unknown arrangement template");
  return reference;
}
