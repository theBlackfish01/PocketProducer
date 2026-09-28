import { ArrowRight, Layers3, SlidersHorizontal, Sparkles } from "lucide-react"
import { Button } from "./ui/button"
import "./welcome-room.css"

const features = [
  { icon: Sparkles, title: "Start with a feeling", text: "Describe a mood, a groove or a detailed vision. Bring a sound if you have one." },
  { icon: SlidersHorizontal, title: "Shape every detail", text: "Explore the sections and parts. Ask for a change and keep what you love." },
  { icon: Layers3, title: "Take it into Audiotool", text: "Copy a finished arrangement to Audiotool to listen and keep editing." },
]

export function WelcomeRoom({ busy, onCreate }: { busy: boolean; onCreate(): void }) {
  return <section className="welcome-room" aria-labelledby="welcome-title">
    <div className="welcome-hero">
      <div className="welcome-copy">
        <p className="welcome-kicker">A little idea. Room to grow.</p>
        <h1 id="welcome-title">Make room for your next idea.</h1>
        <p className="welcome-deck">Turn a few words into an editable arrangement. Find its shape, follow your curiosity, and make it yours.</p>
        <Button size="lg" onClick={onCreate} disabled={busy}>New session <ArrowRight aria-hidden="true" /></Button>
      </div>
      <div className="welcome-art" aria-hidden="true">
        <div className="welcome-sun" /><div className="welcome-orbit" />
        <div className="welcome-music">
          <div className="welcome-music-ruler"><span /><span /><span /><span /></div>
          <div className="welcome-music-lane"><i /><i /><i /></div>
          <div className="welcome-music-lane"><i /><i /><i /></div>
          <div className="welcome-music-lane"><i /><i /><i /></div>
          <div className="welcome-music-lane"><i /><i /><i /></div>
        </div>
        <div className="welcome-hill" />
      </div>
    </div>
    <div className="welcome-features" aria-label="How Pocket Producer works">
      {features.map(({ icon: Icon, title, text }, index) => <article key={title}>
        <div className="welcome-feature-mark"><Icon size={20} aria-hidden="true" /><span>0{index + 1}</span></div>
        <h2>{title}</h2><p>{text}</p>
      </article>)}
    </div>
  </section>
}
