import { GitFork, ExternalLink } from "lucide-react"

export function RepositoryLink({ isPublic = false }: { isPublic?: boolean }) {
  return <a className="repository-link" href="https://github.com/theBlackfish01/PocketProducer" target="_blank" rel="noopener noreferrer" title={isPublic ? "Run Pocket Producer with your own API keys." : "Private repository — access is required to clone and run it with your own API keys."}>
    <GitFork size={15} aria-hidden="true" /><span>{isPublic ? "Run it yourself" : "GitHub · private"}</span><ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
  </a>
}
