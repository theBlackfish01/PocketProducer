import { useLayoutEffect, useRef, useState } from "react"
import type { NativeVersion } from "../../lib/api"
import { arrangementSummary } from "../../lib/ui-copy"
import { Button } from "../../components/ui/button"
import { Fingerprint } from "../../components/fingerprint"

/** Oldest to newest. Choosing a card only opens a read-only comparison. */
export function VersionRail({ versions, currentId, onCompare, onComparePair }: { versions: NativeVersion[]; currentId: string | null; onCompare(id: string): void; onComparePair(firstId: string, secondId: string): void }) {
  const ordered = [...versions].sort((a, b) => a.ordinal - b.ordinal)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const rail = useRef<HTMLOListElement>(null)
  useLayoutEffect(() => { const element = rail.current; if (element) element.scrollLeft = element.scrollWidth }, [versions.length])
  const choose = (id: string) => {
    if (!picking) { onCompare(id); return }
    const next = picked.includes(id) ? picked.filter((value) => value !== id) : [...picked, id].slice(-2)
    setPicked(next)
    if (next.length === 2) { setPicking(false); setPicked([]); onComparePair(next[0], next[1]) }
  }
  return <div className="version-rail-wrap">
    {versions.length > 2 ? <div className="version-rail-toolbar">
      <p role="status">{picking ? picked.length ? "Choose one more version." : "Choose two versions to compare." : "Choose a version to compare it with the current one."}</p>
      <Button variant="ghost" size="sm" aria-pressed={picking} onClick={() => { setPicking(!picking); setPicked([]) }}>{picking ? "Cancel" : "Pick two"}</Button>
    </div> : null}
    <ol className="version-quick-list version-rail" ref={rail} aria-label="Saved versions, oldest first">{ordered.map((version) => <li key={version.id}>
      <button type="button" disabled={versions.length < 2} aria-pressed={picking ? picked.includes(version.id) : undefined} onClick={() => choose(version.id)}>
        <Fingerprint value={version.fingerprint} className="version-thumb" />
        <span className="version-rail-title">Version {version.ordinal}{version.id === currentId ? <small className="version-badge">Current</small> : null}</span>
        <span>{arrangementSummary(version)}</span>
        <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}</time>
      </button>
    </li>)}</ol>
  </div>
}
