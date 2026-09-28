export default async function teardown() {
  await fetch("http://127.0.0.1:19280/api/v1/test/shutdown", { method: "POST" }).catch(() => undefined);
}
