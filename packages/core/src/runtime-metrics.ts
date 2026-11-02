import { getConfig } from "./config.js";

/** Private operational metadata only: never prompts, credentials or heap dumps. */
export function startRuntimeMetrics(role: "supervisor" | "api" | "worker"): () => void {
  if (!getConfig().RUNTIME_METRICS_ENABLED) return () => undefined;
  const report = () => {
    process.stdout.write(`${JSON.stringify({ event: "runtime_memory", role, pid: process.pid, uptimeSeconds: Math.round(process.uptime()), ...process.memoryUsage() })}\n`);
  };
  report();
  const timer = setInterval(report, 300_000);
  timer.unref();
  return () => clearInterval(timer);
}
