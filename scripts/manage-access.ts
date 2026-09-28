import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { closePool, getPool, issueAccess, revokeAccess, linkAudiotoolOwner, REPOSITORY_ROOT } from "@pocket/core";
function ownerId(value: string | undefined) {
  if (!value || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new Error("Provide a valid owner UUID");
  return value;
}
function privatePath(value: string) {
  const path = resolve(value), local = relative(REPOSITORY_ROOT, path);
  if (!local.startsWith(`..${sep}`) && !local.startsWith(`.local${sep}`)) throw new Error("Inside the repository, credentials may only be written under ignored .local/");
  return path;
}

// Credentials go only to an explicitly chosen private file, never deployment logs.
const [action, value, ...args] = process.argv.slice(2);
try {
  if (action === "list") {
    const rows = await getPool().query(`SELECT u.id,u.display_name,a.expires_at,a.revoked_at,i.subject AS audiotool_subject FROM app_user u LEFT JOIN hosted_access a ON a.owner_id=u.id LEFT JOIN audiotool_identity i ON i.owner_id=u.id ORDER BY u.created_at`);
    process.stdout.write(`${JSON.stringify(rows.rows, null, 2)}\n`);
  } else if (action === "link-audiotool" && value && args[0]) {
    await linkAudiotoolOwner(ownerId(value), args[0]); process.stdout.write("Audiotool identity bound to existing owner; music and usage unchanged. Sign-in still requires verified Audiotool consent.\n");
  } else if (action === "revoke" && value) {
    await revokeAccess(ownerId(value)); process.stdout.write("Access revoked; saved work and spending retained.\n");
  } else if (action === "issue" && value) {
    const outputIndex = args.indexOf("--out"), ownerIndex = args.indexOf("--owner-id");
    const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
    if (!output) throw new Error("Provide --out /private/path/invite.txt (never commit/share publicly)");
    const path = privatePath(output);
    // Reserve file before rotating an existing credential.
    const { open } = await import("node:fs/promises");
    const file = await open(path, "wx", 0o600);
    try {
      const result = await issueAccess(value, ownerIndex >= 0 ? ownerId(args[ownerIndex + 1]) : undefined);
      await file.writeFile(`Pocket Producer personal access code (expires in 30 days):\n${result.code}\nOwner: ${result.ownerId}\n`);
      process.stdout.write(`Personal access saved to ${path}. Share privately with this tester only.\n`);
    } finally { await file.close(); }
  } else if (action === "key" && value) {
    const { randomBytes } = await import("node:crypto");
    await writeFile(privatePath(value), randomBytes(32).toString("base64"), { flag: "wx", mode: 0o600 });
    process.stdout.write("Encryption key written to the selected private file. Store it as a Railway secret.\n");
  } else if (action === "export-key" && value) {
    const key = await readFile(resolve(REPOSITORY_ROOT, ".local/secrets/audiotool-session.key"));
    if (key.length !== 32) throw new Error("Existing session key has an invalid length");
    await writeFile(privatePath(value), key.toString("base64"), { flag: "wx", mode: 0o600 });
    process.stdout.write("Existing encryption key exported to the selected private file; original retained.\n");
  } else throw new Error('Usage: pnpm access list | link-audiotool OWNER-UUID users/NAME | issue "Name" --out FILE [--owner-id UUID] | revoke UUID | key FILE | export-key FILE');
} finally { await closePool(); }
