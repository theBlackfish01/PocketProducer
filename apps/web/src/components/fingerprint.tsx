import type { NativeFingerprint } from "@/lib/api"

const placeholderRows = [[2, 9, 16, 23], [5, 12, 19, 26], [2, 13, 24]]

/** Decorative outline of stored notes per part. Meaning is always carried by
 * adjacent text; this never represents loudness, audio or quality. */
export function Fingerprint({ value, className }: { value: NativeFingerprint | null | undefined; className?: string }) {
  // No saved version yet: a neutral, clearly generic outline rather than an empty box.
  if (!value?.lanes.length) return <svg className={`fingerprint is-empty ${className ?? ""}`} viewBox="0 0 32 18" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    {placeholderRows.map((row, index) => <path key={index} d={row.map((x) => `M${x} ${4 + index * 5}h2.2`).join("")} />)}
  </svg>
  const band = 6
  return <svg className={`fingerprint ${className ?? ""}`} viewBox={`0 0 ${value.columns} ${value.lanes.length * band}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
    {value.lanes.map((lane, row) => <path key={row} className={`fingerprint-lane role-${lane.role}`} d={lane.cells.map((cell, column) => cell < 0 ? "" : `M${column + .12} ${(row * band + band - 1.2 - cell / 100 * (band - 2.4)).toFixed(2)}h.76`).join("")} />)}
  </svg>
}
