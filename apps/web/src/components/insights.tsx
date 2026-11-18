import { useEffect, useState } from "react"
import "../features/native/insights.css"
import { Brand } from "./brand"
import { request } from "../lib/api"

interface Report {
  metrics: Record<string,number|null>; month: string; visitorCoverage: string | null; releases: string[]
  ratings: {vote: string; reason: string|null; comment: string}[]
  feedback: {username: string|null; message: string; created_at: string}[]
  issues: {issue:string; total:number}[]
}
const labels: Record<string,string> = {
  active_accounts:"Active accounts",active_projects:"Active projects",first_active_accounts:"First-time active accounts",returning_accounts:"Returning active accounts",
  generation_requests:"Generation requests",completed_generations:"Completed generations",saved_generations:"New versions from generations",revision_requests:"Revision requests",completed_revisions:"Completed revisions",saved_revisions:"New versions from revisions",
  copy_requests:"Copy requests",verified_copies:"Verified Audiotool copies",failed:"Failed requests",needs_attention:"Paused requests",cancelled:"Cancelled requests",pending:"Pending requests",
  median_seconds:"Median time to save (seconds)",p90_seconds:"90th percentile time to save (seconds)",
  completed_model_calls:"Completed producer model calls",recorded_model_usd:"Recorded producer model cost (USD)",unresolved_model_calls:"Unresolved model calls",thumbs_up:"Thumbs up",thumbs_down:"Thumbs down",
  rated_percent:"Saved versions rated (%)",positive_percent:"Positive ratings (%)",site_browser_estimate:"Estimated browsers, whole site"
}
export function Insights() {
  const [month,setMonth] = useState(new Date().toISOString().slice(0,7))
  const [cohort,setCohort] = useState("other")
  const [release,setRelease] = useState("")
  const [report,setReport] = useState<Report|null>(null)
  const [error,setError] = useState("")
  const [retry,setRetry] = useState(0)
  const query = new URLSearchParams({month,cohort,...(release ? {release} : {})}).toString()
  useEffect(() => {
    const controller = new AbortController()
    setReport(null); setError("")
    void request<Report>(`/insights?${query}`,{signal:controller.signal}).then(data => {if (!controller.signal.aborted) setReport(data)}).catch((cause: unknown) => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load report.")})
    return () => controller.abort()
  },[query,retry])
  return <main className="insights"><Brand />
    <h1>Project insights</h1><p>Monthly activity by request start date, in UTC. An active account started a generation, revision or copy.</p>
    <div className="report-filters"><label>Month<input type="month" value={month} onChange={e => {if(e.target.value){setMonth(e.target.value);setRelease("")}}} /></label>
    <label>Accounts<select value={cohort} onChange={e=>setCohort(e.target.value)}><option value="other">Other verified accounts</option><option value="internal">Owner and known tests</option><option value="unattributed">Unattributed</option><option value="all">All accounts</option></select></label>
    <label>Release<select value={release} onChange={e=>setRelease(e.target.value)}><option value="">All releases</option>{Array.from(new Set([...(report?.releases ?? []),...(release ? [release] : [])])).map(value=><option key={value} value={value}>{value.slice(0,10)}</option>)}</select></label></div>
    {error ? <p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p> : !report ? <p role="status">Loading report…</p> : <>
    <a href={`/api/v1/insights?${query}&format=csv`}>Download monthly CSV</a>
    <dl>{Object.entries(labels).map(([key,label])=><div key={key}><dt>{label}</dt><dd>{report.metrics[key]?.toLocaleString(undefined,{maximumFractionDigits:4}) ?? "—"}</dd></div>)}</dl>
    <p>Browser estimates include all accounts and signed-out visits.{report.visitorCoverage ? " Visitor coverage this month begins "+report.visitorCoverage.slice(0,10)+"." : " No visitor measurements for this month."} Older releases can appear as unknown.</p>
    {report.issues.length ? <><h2>Workflow issues</h2><ul>{report.issues.map(row=><li key={row.issue}>{row.issue} · {row.total}</li>)}</ul></> : null}
    <h2>Rating details</h2>{report.ratings.some(r=>r.reason || r.comment) ? <ul>{report.ratings.filter(r=>r.reason || r.comment).map((r,i)=><li key={i}>{r.vote === "up" ? "Thumbs up" : "Thumbs down"}{r.reason ? " · "+r.reason : ""}{r.comment ? <p>{r.comment}</p> : null}</li>)}</ul> : <p>No written rating details.</p>}
    <h2>General feedback</h2><p>For the selected month and account group, across all releases.</p>{report.feedback.length ? <ul>{report.feedback.map((r,i)=><li key={i}><strong>{r.username ?? "Listener"}</strong><p>{r.message}</p></li>)}</ul> : <p>No feedback for this group.</p>}
    </>}</main>
}
