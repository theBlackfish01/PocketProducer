// Browser-safe catalogue. A version ID identifies both an editable score and its recording.
export const arrangementTemplates = [
  { id: "french-house-v1", title: "Mercury Arcade", style: "French house", bpm: 118, beats: 4, bars: 24, description: "Clipped chords and octave bass. A bright pickup returns higher." },
  { id: "broken-beat-v1", title: "Last Table", style: "Broken beat", bpm: 86, beats: 4, bars: 20, description: "Late electric keys, syncopated bass and a falling bell phrase." },
  { id: "chamber-waltz-v1", title: "The Paper Observatory", style: "Chamber waltz", bpm: 76, beats: 3, bars: 20, description: "A four-note glass melody rises over bowed bass and swelling strings." },
  { id: "synthwave-v1", title: "Violet Overpass", style: "Synthwave", bpm: 104, beats: 4, bars: 20, description: "Pulsing bass and wide synth chords. The lead returns an octave higher." },
  { id: "bossa-nova-v1", title: "Patio Radio", style: "Bossa nova", bpm: 112, beats: 4, bars: 16, description: "Offbeat plucks and a lilting bass leave room for a soft call and response." },
  { id: "tidal-ambient-v1", title: "Tide Almanac", style: "Ambient", bpm: 66, beats: 4, bars: 16, description: "Slow bass swells and suspended chords, with a few high bells and no drums." },
] as const

export type ArrangementTemplate = (typeof arrangementTemplates)[number]
export type ArrangementTemplateId = ArrangementTemplate["id"]
export const findArrangementTemplate = (id: unknown) => arrangementTemplates.find(template => template.id === id)
export const templateStartingDirection = (template: ArrangementTemplate) => "Start from the " + template.title + " arrangement."

export function usesTemplateAsWritten(template: ArrangementTemplate | undefined, direction: unknown, sourceCount: number) {
  return Boolean(template && sourceCount === 0 && direction === templateStartingDirection(template))
}
