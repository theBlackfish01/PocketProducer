import type { symbolicNativeReview } from "./critique.js";

type Summary = ReturnType<typeof symbolicNativeReview>;

// Lossless tuple encoding first; only the final pressure tier shortens note
// selections/keyframes. Never drop a section, represented part, requirement,
// prior finding, exact boundary value or sound setting to manufacture approval.
export function compactNativeReviewEvidence(summary: Summary, minimal = false) {
  return {
    ...summary,
    musicality: minimal ? { ...summary.musicality, issues: summary.musicality.issues.slice(0, 5) } : summary.musicality,
    timing: { ...summary.timing, previewCoverage: "onsetPreview is a bounded leading selection; finalOnsets is an overlapping tail, not additional notes. Coverage/omission counts accompany each selection. Missing preview events do not imply silence. rhythmWindow describes only its stated interval." },
    evidenceLayout: {
      mode: minimal ? "bounded-tuples" : "lossless-tuples",
      part: ["id", "newOnsets", "onsetsPerBar", "noteRange", "clips", "onsetPreview", "omittedPreviewOnsets", "finalOnsets", "omittedTailSelection", "rhythmWindow", "motifIds", "automation", "omittedAutomation", "preset", "soundingNotes", "clipIntervals", "omittedClipIntervals"],
      automation: ["target", "first", "last", "exactBoundaryValues", "points", "omittedPoints"],
      point: ["tick", "value", "interpolation", "slope"],
      caveat: "Part role/device/settings are in soundEvidence by id. Automation values are normalized; points use absolute ticks. Null interpolation/slope means canonical default. Boundary values do not establish interior curve shape. Omitted facts are unknown, not absent. Preview/tail/window selections can overlap; never add their counts. All represented sections and parts are retained."
    },
    sections: summary.sections.map(section => ({ ...section, parts: section.parts.map(part => {
      const preview = minimal ? part.onsetPreview.slice(0, 2) : part.onsetPreview;
      const tail = minimal ? part.finalOnsets.slice(-2) : part.finalOnsets;
      const window = part.rhythmWindow;
      const notes = minimal ? window?.notes.slice(0, 8) : window?.notes;
      return [part.id, part.newOnsets, part.onsetsPerBar, part.noteRange, part.clips,
        preview, part.newOnsets - preview.length, tail, part.finalOnsets.length - tail.length,
        window ? { ...window, notes, omittedOnsets: window.totalOnsets - (notes?.length ?? 0) } : null,
        part.motifIds, part.automation.map(curve => [curve.target, curve.first, curve.last, curve.exactBoundaryValues,
          minimal ? [] : curve.points.map(point => [point.tick, point.value, point.interpolation ?? null, point.slope ?? null]),
          curve.omittedPoints + (minimal ? curve.points.length : 0)]), part.omittedAutomation, part.preset, part.soundingNotes, part.clipIntervals, part.omittedClipIntervals];
    }) })),
    sharedProcessing: { ...summary.sharedProcessing, groups: summary.sharedProcessing.groups.map(group => ({ ...group,
      automation: group.automation?.map(curve => {
        const points = minimal ? [curve.points[0]!, curve.points.at(-1)!] : curve.points;
        return { ...curve, points, omittedPoints: curve.points.length - points.length };
      })
    })) }
  };
}
