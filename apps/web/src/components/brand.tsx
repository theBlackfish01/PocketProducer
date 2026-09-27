export function Brand() {
  return <a className="brand-lockup" href="/" aria-label="Pocket Producer home" onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (window.location.pathname !== "/") window.history.pushState({}, "", "/")
    window.dispatchEvent(new PopStateEvent("popstate"))
  }}>
    <img className="brand-mark" src="/pocket-producer-mark.svg" width="48" height="48" alt="" />
    <span className="brand-name">Pocket Producer</span>
  </a>
}
