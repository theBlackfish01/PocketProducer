export default async function teardown(): Promise<void> {
  const apiPort = Number(process.env.E2E_API_PORT ?? 18_787);
  const workerPort = Number(process.env.E2E_WORKER_HEALTH_PORT ?? 18_788);
  const webPort = Number(process.env.E2E_WEB_PORT ?? 15_173);
  await Promise.allSettled([
    fetch(`http://127.0.0.1:${apiPort}/api/v1/test/shutdown`, { method: "POST" }),
    fetch(`http://127.0.0.1:${workerPort}/shutdown`, { method: "POST" }),
    fetch(`http://127.0.0.1:${webPort}/__test_shutdown`, { method: "POST" })
  ]);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
}
