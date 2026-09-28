import { posix, win32 } from "node:path";

/** Convert old absolute storage paths to portable owned paths, never guess a basename. */
export function relocatedAssetPath(oldRoot: string, objectPath: string): string {
  const paths = /^[A-Za-z]:[\\/]/.test(oldRoot) ? win32 : posix;
  if (!paths.isAbsolute(oldRoot)) throw new Error("Old storage root must be absolute");
  const relative = paths.isAbsolute(objectPath) ? paths.relative(oldRoot, objectPath) : objectPath;
  const portable = relative.replaceAll("\\", "/");
  if (!portable || portable.split("/").some((part) => part === ".." || part === "." || part === "") || portable.includes(":")) throw new Error("Asset is outside the specified old root");
  if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/sources\/[a-f0-9]{64}\.wav$/.test(portable)) throw new Error("Unrecognized owned-source path; inspect manually");
  return portable;
}
