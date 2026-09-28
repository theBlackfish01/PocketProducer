import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

// Explicit local Docker verification; separate DB from unit/integration/browser runs.
// Requires prepare-test with TEST_DATABASE_URL ending in pocket_producer_deploy_test.
const exec = promisify(execFile), name = `pocket-readiness-${randomUUID().slice(0,8)}`, volume = `${name}-data`, maintenance = `${name}-maintenance`;
async function docker(...args: string[]) { return (await exec("docker",args,{windowsHide:true,maxBuffer:2_000_000})).stdout.trim(); }
const base="http://127.0.0.1:19281";
async function ready(){
  for(let n=0;n<150;n++){
    if(await fetch(`${base}/healthz`).then(r=>r.ok).catch(()=>false)) return;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error("Container readiness timed out");
}
try {
  await docker("volume","create","--label","pocket.test=readiness",volume);
  await docker("run","-d","--name",name,"--label","pocket.test=readiness","-p","127.0.0.1:19281:8080","--mount",`type=volume,source=${volume},target=/data`,
    "-e","PORT=8080","-e","APP_ORIGIN=https://pocket.example","-e","FIXTURE_MODE=true","-e","HOSTED_AUTH_MODE=invite",
    "-e","DATABASE_URL=postgresql://pocket:pocket_local_only@host.docker.internal:54329/pocket_producer_deploy_test",
    "-e",`AUDIOTOOL_SESSION_KEY=${Buffer.alloc(32,7).toString("base64")}`,
    "-e","INITIAL_BUILD_API_BUDGET_USD=0","-e","MAX_JOB_COST_USD=0","-e","LANGSMITH_TRACING=false","pocket-producer:readiness");
  await ready();
  assert.equal((await fetch(`${base}/`)).status,200);
  assert.equal((await fetch(`${base}/api/v1/projects`)).status,401);
  // Test only the built image and task-owned volume; never touch local credentials.
  await docker("exec","--user","1000:1000",name,"node","-e",String.raw`const fs=require('fs'); if(fs.existsSync('/app/.env') || fs.existsSync('/app/.local')) throw Error('Private material included'); fs.writeFileSync('/data/audio/restart-check.txt','retained');`);
  await docker("restart",name); await ready();
  assert.equal(await docker("exec","--user","1000:1000",name,"node","-e","process.stdout.write(require('fs').readFileSync('/data/audio/restart-check.txt','utf8'))"),"retained");
  // Kill only the worker identified inside this test container. Supervisor must
  // stop the API and fail the container, leaving Railway to perform the restart.
  await docker("exec","--user","1000:1000",name,"node","-e",String.raw`const fs=require('fs'); const ids=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)).filter(x=>{try{return fs.readFileSync('/proc/'+x+'/cmdline','utf8').split('\0').includes('apps/worker/src/worker.ts')}catch{return false}}); if(ids.length!==1)throw Error('Expected one worker'); if(!/^Uid:\s+1000\s/m.test(fs.readFileSync('/proc/'+ids[0]+'/status','utf8')))throw Error('Worker is root');process.kill(Number(ids[0]),'SIGKILL');`);
  const exit=await docker("wait",name); assert.equal(exit,"1");
  await docker("run","-d","--name",maintenance,"--label","pocket.test=readiness","-p","127.0.0.1:19281:8080","-e","PORT=8080","-e","APP_ORIGIN=https://pocket.example","-e","HOSTED_AUTH_MODE=invite","-e","HOSTED_MAINTENANCE=true","-e","DATABASE_URL=postgresql://localhost:1/must_not_connect","-e",`AUDIOTOOL_SESSION_KEY=${Buffer.alloc(32,7).toString("base64")}`,"pocket-producer:readiness");
  await ready(); assert.equal(await (await fetch(`${base}/healthz`)).text(),"maintenance");
  assert.equal((await fetch(`${base}/api/v1/projects`)).status,503);
  console.log("Container smoke passed: production serving, unauthenticated denial, non-root worker, no private build files, persistent volume, restart, worker-failure shutdown and maintenance without a database. No provider calls.");
} finally {
  // Exact task-created names; verify labels before any removal.
  if(await docker("inspect","--format",'{{index .Config.Labels "pocket.test"}}',name).catch(()=>"") === "readiness") await docker("rm","-f",name);
  if(await docker("inspect","--format",'{{index .Config.Labels "pocket.test"}}',maintenance).catch(()=>"") === "readiness") await docker("rm","-f",maintenance);
  if(await docker("volume","inspect","--format",'{{index .Labels "pocket.test"}}',volume).catch(()=>"") === "readiness") await docker("volume","rm",volume);
}
