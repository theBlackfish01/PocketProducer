import { GitFork, ExternalLink } from "lucide-react"

export function RepositoryLink() {
  return <a className="repository-link" href="https://github.com/theBlackfish01/PocketProducer" target="_blank" rel="noopener noreferrer">
    <GitFork size={15} aria-hidden="true" /><span>GitHub</span><ExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
  </a>
}
