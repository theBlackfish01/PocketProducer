import type { ReactNode } from "react"

interface RoomHeroProps {
  status: string
  title: string
  description: string
  meta?: string
  actions?: ReactNode
}

export function RoomHero({ status, title, description, meta, actions }: RoomHeroProps) {
  return <header className={`room-hero session-header ${title.length > 34 ? "room-hero-long" : ""}`}>
    <div className="room-hero-art" aria-hidden="true"><span className="hero-orbit" /><span className="hero-sun" /><span className="hero-hill" /></div>
    <div className="room-hero-content">
      <div className="eyebrow"><span className="status-dot" /> {status}</div>
      <h1 className="session-title">{title}</h1>
      <p className="session-deck">{description}</p>
      {meta ? <p className="room-meta">{meta}</p> : null}
    </div>
    {actions ? <div className="room-hero-actions">{actions}</div> : null}
  </header>
}
