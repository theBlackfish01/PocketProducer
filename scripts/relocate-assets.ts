import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { getPool, closePool, relocatedAssetPath, safeStoragePath } from "@pocket/core";

const args=process.argv.slice(2), index=args.indexOf("--from"), from=index>=0 ? args[index+1] : undefined;
if(!from) throw new Error('Usage: pnpm assets:relocate --from "OLD_ABSOLUTE_AUDIO_ROOT" [--apply]');
try {
  const rows=await getPool().query<{id:string;object_path:string;content_hash:string}>("SELECT id,object_path,content_hash FROM asset WHERE kind='source' AND readiness='ready'");
  const changes=[];
  for(const row of rows.rows){
    const path=relocatedAssetPath(from,row.object_path), hash=createHash("sha256");
    for await(const chunk of createReadStream(safeStoragePath(path))) hash.update(chunk as Buffer);
    if(hash.digest("hex")!==row.content_hash) throw new Error(`Source checksum mismatch for asset ${row.id}; nothing updated`);
    changes.push({...row,path});
  }
  if(args.includes("--apply")) {
    const client=await getPool().connect();
    try {
      await client.query("BEGIN");
      for(const row of changes) {
        const update=await client.query("UPDATE asset SET object_path=$1 WHERE id=$2 AND object_path=$3 AND content_hash=$4",[row.path,row.id,row.object_path,row.content_hash]);
        if(update.rowCount!==1) throw new Error("Asset changed while relocating; retry after stopping writes");
      }
      await client.query("COMMIT");
    } catch(error){await client.query("ROLLBACK");throw error;} finally {client.release();}
  }
  process.stdout.write(`${changes.length} owned sources verified; ${args.includes("--apply") ? "portable paths applied" : "dry run only, no changes"}.\n`);
} finally {await closePool();}
