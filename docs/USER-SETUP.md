# Remaining user setup

For the current construction pass, run `pnpm db:up`, `pnpm db:migrate` (adds migrations through 013 without rewriting prior music), then `pnpm dev`. Open `http://127.0.0.1:5173`, create an Arrange room, attach only sources you own, describe the arrangement and submit. Use part/section scope and **Keep unchanged** for a precise follow-up, inspect the factual version comparison, and restore explicitly if desired. An unfinished job displays its confirmed tentative structure separately from the selected version. **Continue saved draft** is available only with a safe remaining call allowance and unchanged head; otherwise the room explains why. Connected Audiotool search is metadata-only; selection still needs trusted producer resolution. Historical presets without a content fingerprint require deliberate reselection in a new version before synchronization. No native play button exists because native audio retrieval is deferred. See [current coverage and limits](native-construction-followup.md).

No user action is needed for offline native construction. OpenAI and Gemini credentials are already present; do not create, paste, or rotate them for ordinary tests. Those tests force fixture mode, clear provider credentials in child processes, and have zero provider access. Audiotool registration and browser consent were completed on 2026-09-23; see [historical native render probe results](../spikes/nexus-audio/RESULTS-2026-09-23.md). The current native assignment explicitly defers rendering and did not contact Audiotool.

Native synchronization is an explicit opt-in action in the Listening Room. Source-free and owned-WAV source-bearing versions are eligible when saved consent is present; source upload/readiness and interval mapping have passed an offline contract test, **not** live Studio verification. If the non-refreshable session has expired, choose **Connect Audiotool** again in the regular signed-in browser. Do not treat a local draft or old verification timestamp as current remote agreement. A first live native synchronization requires a separately authorized bounded disposable test; this assignment did not contact Audiotool. Never retry an uncertain remote create/upload/write under a new key without reconciliation.

Separate optional live-verification actions remain. The next construction check would be a specifically authorized disposable native Studio sync/readback, first source-free and then with an owned WAV; it must not render or publish. The older Audiotool production stem export has not been run, and native render result retrieval was deferred after public operation lookup returned 403. Gemini connectivity must be diagnosed before authorizing a new live verification identity: the retained 2026-09-21 two-call identity is terminal after transport failures with no provider telemetry and must not be replayed.

## Audiotool application registration

Create one development application at `https://developer.audiotool.com/applications`, then use this exact local registration block:

```text
Application purpose: Pocket Producer local development
Redirect URL: http://127.0.0.1:5173/auth/audiotool/callback
Requested scopes: user:read project:write project:read sample:write sample:read preset:read preset:write
```

Add the issued public client identifier to the existing ignored root `.env` without changing the provider keys:

```dotenv
AUDIOTOOL_CLIENT_ID=<issued public client id>
AUDIOTOOL_REDIRECT_URL=http://127.0.0.1:5173/auth/audiotool/callback
AUDIOTOOL_SCOPES=user:read project:write project:read sample:write sample:read preset:read preset:write
```

Restart `pnpm dev`, open the Listening Room in the regular browser profile used for Audiotool sign-in, and choose **Connect Audiotool**. The SDK validates its PKCE state and callback; Pocket Producer hands the resulting session directly to the loopback API, encrypts it with an automatically generated ignored local key, and binds it to the local app owner. The live grant did not include a usable refresh token, so reconnect after the access token expires. Do not paste access or refresh tokens into chat or `.env`.

The installed Nexus 0.0.17 types and official examples document `project:write` for project creation/editing, but do not publish a separate operation-to-scope declaration for sample upload. The first authorized test must therefore confirm that the registered grant also permits `samples.upload`; if Audiotool returns a scope error, preserve that exact sanitized error and adjust the registered scope only from Audiotool’s own response/documentation.

For a later stem-export check, explicitly authorize one export from a disposable test revision. The installed Nexus SDK offers `unlisted`, not a private project-creation option, so confirm account visibility before proceeding. Success means Studio opens with four separately editable audio stems aligned at tick 0, the project tempo and time signature match the canonical composition, and the musical body plus explicit tail have the expected duration. It does not imply note-level editability. Native note editability in the separate scratch project has now been verified, while native render-result retrieval remains blocked at the public OperationService permission boundary.

## Optional Gemini diagnosis

Do not rerun the retained live verifier. First confirm that this host can reach the configured Gemini endpoint without changing the key or consuming another application identity. If a new bounded verification is desired afterward, authorize a new identity explicitly. The verifier makes at most one source-analysis call and one preview-critique call, never calls OpenAI, and never renders again; the shared US$5 ledger still applies.
