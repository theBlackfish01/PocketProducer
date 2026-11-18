// Rotate a random bucket monthly. The server only keeps a bitmap, without paths or account identifiers.
let pending = false
export async function recordVisitor() {
  if (pending || document.visibilityState !== "visible" || navigator.webdriver || navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return
  const month = new Date().toISOString().slice(0,7)
  pending = true
  try {
    const key = "pp-visit="
    const prior = document.cookie.split("; ").find(v => v.startsWith(key))?.slice(key.length).split(".")
    if (prior?.[0] === month && prior[2] === "counted") return
    const bucket = prior?.[0] === month && /^\d{1,5}$/.test(prior[1] ?? "") && Number(prior[1]) < 65536 ? Number(prior[1]) : crypto.getRandomValues(new Uint16Array(1))[0]
    const now = new Date()
    const expires = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toUTCString()
    const remember = (state: string) => { document.cookie = `${key}${month}.${bucket}.${state}; Path=/; Expires=${expires}; SameSite=Lax; Secure` }
    remember("pending")
    if (!document.cookie.split("; ").includes(`${key}${month}.${bucket}.pending`)) return
    const response = await fetch("/api/v1/visits", { method:"POST", credentials:"omit", headers:{"Content-Type":"application/json"},body:JSON.stringify({ month,bucket }) })
    if (response.ok) remember("counted")
  } catch { /* Optional measurement must never interrupt sign-in or music. */ }
  finally { pending = false }
}
