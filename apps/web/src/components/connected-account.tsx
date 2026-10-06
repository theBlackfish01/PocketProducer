import { useEffect, useState } from "react"
import { UserRound } from "lucide-react"
import { api } from "../lib/api"
import { Button } from "./ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu"

export function ConnectedAccount({ connected, userName, onConnect, onDisconnect }: { connected: boolean; userName: string | null; onConnect(): void; onDisconnect(): void }) {
  const [profile, setProfile] = useState<{ userName: string; displayName: string; avatarUrl: string | null } | null>(null)
  const [failedImage, setFailedImage] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    setProfile(null)
    if (connected) void api.audiotoolProfile(controller.signal).then(({ profile: value }) => { if (!controller.signal.aborted && value?.userName === userName) setProfile(value) }).catch(() => undefined)
    return () => controller.abort()
  }, [connected, userName])
  const name = connected ? profile?.displayName ?? userName?.replace(/^users\//, "") ?? "Audiotool account" : "Connect Audiotool"
  const avatar = connected && profile?.userName === userName ? profile.avatarUrl : null
  return <div className="account-row"><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" aria-label={connected ? `Audiotool account: ${name}` : "Connect Audiotool account"} />}><span className="account-avatar">{avatar && failedImage !== avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(avatar)} /> : connected ? name.slice(0, 1).toLocaleUpperCase() : <UserRound size={18} />}</span><span className="account-name">{name}{connected ? <small>Connected</small> : null}</span></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={onConnect}>{connected ? "Reconnect Audiotool" : "Connect Audiotool"}</DropdownMenuItem>{connected ? <DropdownMenuItem onClick={onDisconnect}>Disconnect Audiotool</DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu></div>
}
