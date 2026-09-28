# Railway launch runbook

The default is **open Sign in with Audiotool**. Anyone with an Audiotool account can consent and receive a private Pocket Producer workspace. The server verifies their Audiotool identity, saves the connection, and issues a session lasting at most seven days. Returning accounts retain projects and spending. No invitation is needed. The optional `HOSTED_AUTH_MODE=invite` is only for a deliberately private preview. Never expose the loopback development identity.

Commands below use `pnpm`; on Windows, use `corepack pnpm` if `pnpm` is not on PATH. The container already provides the pinned command.

## 1. What is shipped

- `Dockerfile`: pinned Node 22.14.0 / pnpm 11.19.0, frozen dependency install, built React frontend; no `.env`, private files, dumps or traces copied into the image.
- `railway.toml`: one replica, `/healthz`, bounded restart policy.
- `pnpm start`: checks configuration/storage, serializes SQL migrations, starts the background worker, then serves the frontend and API on the same origin. Worker failure/heartbeat loss stops the service so Railway can restart it. Existing lease/effect fences handle interrupted work; uncertain paid/remote effects still require reconciliation.
- Production requests use `__Host-` Secure/HttpOnly/SameSite=Lax cookies. All project, job, source, library and activity routes resolve their owner from the server session. Cross-origin writes are rejected. Logout/revocation closes existing activity streams. Query strings are excluded from request logs (including OAuth callback codes).
- Sign-in starts are globally limited to 60/minute, owner writes to 30/minute, and queued/running jobs to one per owner/eight total. Stop/end-attempt and sign-out remain available after write throttling; ownership and origin checks still apply. Worker concurrency remains one. Existing owner/model/provider/site spending caps apply. These are small-demo safeguards, not protection from multiple accounts or network-level attacks; use hosting monitoring and operator revocation too.

## 2. Railway project and services

Create/select the correct workspace, then create:

1. **Postgres** with its persistent database volume. Keep it on Railway private networking. Public DB access is only needed temporarily for a controlled migration; remove it afterward.
2. **Pocket Producer** from this repository's reviewed, pushed release branch. Root directory `/`; build uses the checked-in Dockerfile and Railway config. Do not use `pnpm dev`, Vite preview or a separate API domain.
3. Attach a persistent application volume at **`/data`**. Keep one replica. API and worker share `/data/audio` inside the same service. The container initializes that directory, drops to UID/GID 1000, and runs application processes without root. Copied source directories/files must be readable by UID 1000; new directories must be writable by it.
4. Generate an HTTPS service domain. A custom domain is optional. Keep serverless sleeping disabled: the worker polls for durable jobs.
   Keep `HOSTED_MAINTENANCE=true` during setup: the container stays available for operator access, but exposes only a maintenance message and health check. It does **not** run migrations, the API or worker, so the destination database stays untouched until you restore it.
5. Keep the checked-in health check `/healthz`. It checks the database; the supervisor separately monitors the worker. Enable volume backups and Railway spending alerts. Railway hosting costs and AI-provider costs are independent.

The default start command is the image CMD. Do not override it with `pnpm start` on Railway: the image entrypoint also initializes volume permissions and drops privileges.

## 3. Exact service variables

Copy the template in `deploy/railway.env.example` into **service variables**, replacing placeholders. Never commit your real values. No secret gets a `VITE_` prefix. Railway supplies `PORT` automatically.

| Variable | Value/action |
| --- | --- |
| `APP_ENV` | `production` |
| `DEV_LOCAL_AUTH` | `false`; never bypass this to get a deployment working |
| `HOSTED_AUTH_MODE` | `audiotool` (default). No invitation codes required |
| `SERVE_WEB` | `true` |
| `HOSTED_MAINTENANCE` | Start `true`; switch to `false` after data/ledger checks and original-owner binding |
| `APP_ORIGIN` | Exact `https://YOUR-DOMAIN` without trailing slash |
| `DATABASE_URL` | Reference `${{Postgres.DATABASE_URL}}` (adjust the service name if different); use private networking |
| `OBJECT_STORAGE_LOCAL_ROOT` | `/data/audio` |
| `AUDIOTOOL_SESSION_KEY` | Stable base64 of 32 random bytes; see existing-data instructions below |
| `AUDIOTOOL_CLIENT_ID` | Your registered application's client ID; reuse your existing local value for this deployment |
| `AUDIOTOOL_REDIRECT_URL` | `https://YOUR-DOMAIN/auth/audiotool/callback` |
| `AUDIOTOOL_SCOPES` | `user:read project:write project:read sample:write sample:read preset:read preset:write` |
| `OPENAI_API_KEY`, `GEMINI_API_KEY` | Securely copy existing credentials from your password manager/local env to Railway; do not paste in chat |
| `FIXTURE_MODE` | Start `true` during transfer. Real Audiotool sign-in requires `false`; initially keep provider keys absent and all spending caps zero to verify only login |
| `WORKER_CONCURRENCY` | `1` |
| `LANGSMITH_TRACING` | Optional; start `false`. If enabled, set existing key/project and decide deliberately whether private prompt payloads may be captured |
| `SOURCE_REPOSITORY_PUBLIC` | Keep `false` while GitHub is private; changing this does not publish the repository |

Budget configuration must move with the ledger. Do **not** infer unused provider credit from configured limits. Start with zero limits in the template. After verifying the restored ledger, copy the current authorized values from the existing installation: `SOL_POOL_BUDGET_USD`, `LUNA_POOL_BUDGET_USD`, `OPENAI_POOL_BUDGET_USD`, `GEMINI_POOL_BUDGET_USD`, `GATEWAY_POOL_BUDGET_USD`, `INITIAL_BUILD_API_BUDGET_USD`, `DEFAULT_USER_BUDGET_USD`, and `MAX_JOB_COST_USD`. Also carry over run/model settings. The approved model allocations are cumulative Sol $5 and Luna $50, not fresh deployment credits. Earlier other-model spending and unknown liabilities stay counted. Leave `AI_GATEWAY_API_KEY` unset unless deliberately maintaining an old Gateway request; do not resume one just because the key exists.

## 4. Preserve existing data and spending (before live startup)

Do this during a short maintenance window. Stop local API/worker and ensure there are no running, queued or cancel-requested jobs before taking the snapshot. Do not run local and hosted workers concurrently against a copied ledger. A split database can spend the same remaining allowance twice.

1. Record `pnpm budget:status` locally. This is read-only and does not call providers.
2. Make a private PostgreSQL **custom-format backup of the entire application database**, using `pg_dump --format=custom --no-owner --no-acl`. Restore it into the new empty hosted database with `pg_restore --no-owner --no-acl`. Use PostgreSQL 17-compatible clients and private credential handling; never put passwords in committed scripts or pasted commands. Do not restore over a database already receiving user work. Full restoration preserves IDs, ownership, immutable versions, unknown effects, limits and checkpoint data.
3. Copy the contents of the existing configured audio root (`.local/audio` by default) into `/data/audio`, preserving its owner/project/source hierarchy. Copy privately; no public audio bucket is needed.
4. Export the **existing** OAuth encryption key locally: `pnpm access export-key .local/railway-session-key.txt`. It writes a private file, not a console secret. Put its contents into Railway's `AUDIOTOOL_SESSION_KEY` and your password manager. Preserve the original file. Do not generate a different key if restoring encrypted sessions.
5. For a genuinely new installation with no sessions/data/usage to preserve, `pnpm access key .local/railway-session-key.txt` creates a new key instead. A new database for this existing funded demo needs an explicit accounting migration, not a usage reset; prefer full restoration.
6. Apply migrations with `pnpm db:migrate` against the hosted DB, before starting the live worker. Startup also runs migrations safely/idempotently.
7. Existing source paths may be Windows absolute paths. On the host, after copying the files, run:

   ```sh
   pnpm assets:relocate --from 'C:\path\to\PocketProducer\.local\audio'
   pnpm assets:relocate --from 'C:\path\to\PocketProducer\.local\audio' --apply
   ```

   Substitute the actual old storage root if different. The first command changes nothing. Every source must exist at its new location and match the saved SHA-256 before the second command updates paths in one transaction. Unexpected layouts fail for inspection rather than guessing.
8. Run `pnpm budget:status` on Railway and compare counts, amounts and unknown liabilities with the local snapshot. Do not enable live keys/generation until they agree. Back up DB + sources + encryption key together. Keep the old local installation offline for paid work after cutover.
9. Before releasing maintenance, check `SELECT state,count(*) FROM job WHERE state IN ('queued','running','cancel_requested') GROUP BY state;` returns no rows. If it does, resolve those jobs deliberately before transfer/release; do not silently let fixture mode process restored live work. Bind your original owner below, then set `HOSTED_MAINTENANCE=false`. Railway restarts into the normal supervised application.

Railway's remote shell/SSH or an operator-only container session can run these commands. Do not place invitation issuance, key export or database restore in automatic build/start commands.

## 5. Preserve your account and open sign-in

Before your first hosted sign-in, use `pnpm access list` in the hosted container and identify your original local listener owner. Bind it to your exact Audiotool resource name (not a display name). Confirm your own account resource name before running. The binding is an explicit operator trust decision; later login still requires Audiotool verification. No credentials are printed:

```sh
pnpm access link-audiotool EXISTING-OWNER-UUID users/YOUR-AUDIOTOOL-ACCOUNT
# Revoke an abusive account; history and ledger remain intact, re-login is denied.
pnpm access revoke OWNER-UUID
```

Everyone else just clicks **Sign in with Audiotool**. Each verified account receives a separate owner automatically. Do not prebind another person to your owner. Conflicting/already-used bindings fail instead of merging data. If you already signed in before binding, stop and reconcile the two owners explicitly; do not reset or delete spending. On shared browsers, Sign out clears local drafts/caches; saved projects remain. Disconnect Audiotool removes the integration connection, not the app account; reconnect requires the same account. To deliberately change account, sign out first. A renamed Audiotool resource is not automatically linked by display name; reconcile verified identity changes as an operator.

Optional private-only mode: set `HOSTED_AUTH_MODE=invite`, then use `pnpm access issue "Name" --out /data/private-invite.txt [--owner-id UUID]` and share individually. That route is disabled in public Audiotool mode. Do not switch modes as a way to evade account revocation or usage.

## 6. Audiotool registration change

In your existing Audiotool app registration, add the exact **hosted HTTPS callback** from section 3 to the redirect allowlist. Keep loopback registered only if still needed locally. Keep the client ID and existing scopes, including **`user:read`**. Click **Sign in with Audiotool** in your normal browser and complete consent. This both signs you in and connects Audiotool; copying a composition remains an explicit separate action. A local browser connection is not automatically a hosted connection. No client secret or new provider key is needed for this public-client PKCE flow. This implementation pass does not itself perform consent or contact authenticated Audiotool endpoints.

## 7. Launch checks and demo

- Verify signed-out API access is denied; sign in with two Audiotool accounts and confirm projects, files, activity and connections are separate. Start with live OAuth enabled (`FIXTURE_MODE=false`) but provider keys absent and zero spending caps.
- Offline verification is `pnpm test:hosted`: scripted OAuth transport plus real local API/database cookies, and a separate invitation fixture create journey. Fixture mode refuses real OAuth dispatch. Never enable a test transport via production environment variables. Fixture output is not live identity or real-model evidence.
- After restoring/checking spending, enable approved live configuration. Perform one explicitly budgeted full run and one explicit Audiotool copy. Verify the editable document and listen in Studio. Native in-app full-mix playback remains deferred.
- Record the video only after that hosted journey succeeds. Show prompt → confirmed construction → inspect a section → protected change → compare → Copy to Audiotool → Studio. Keep access codes, provider keys, private traces and operator commands out of the recording.

## Remaining external gates

This runbook does not create Railway services, set secrets, choose a GitHub license, publish the repository, modify Audiotool registration, grant consent, deploy, or spend. Railway must be able to see the target project and private GitHub repository. A real hosted OAuth round trip and a bounded live music/copy test are still required. Endpoint/identity behavior is based on the pinned SDK and [official authentication documentation](https://developer.audiotool.com/js-package-documentation/documents/Authentication.html), not a live verification. Native in-app playback remains deferred.
