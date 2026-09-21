# Remaining user setup

No user action is needed for the offline milestone. OpenAI and Gemini credentials are already present; do not create, paste, or rotate them for ordinary tests. Those tests force fixture mode, clear provider credentials in child processes, and have zero provider access.

Two optional live-verification actions remain. Audiotool registration and browser consent are required before a real remote export. Gemini connectivity must be diagnosed before authorizing a new live verification identity: the retained 2026-09-21 two-call identity is terminal after transport failures with no provider telemetry and must not be replayed.

## Audiotool application registration

Create one development application at `https://developer.audiotool.com/applications`, then use this exact local registration block:

```text
Application purpose: Pocket Producer local development
Redirect URL: http://127.0.0.1:5173/auth/audiotool/callback
Requested scope: project:write
```

Add the issued public client identifier to the existing ignored root `.env` without changing the provider keys:

```dotenv
AUDIOTOOL_CLIENT_ID=<issued public client id>
AUDIOTOOL_REDIRECT_URL=http://127.0.0.1:5173/auth/audiotool/callback
AUDIOTOOL_SCOPES=project:write
```

Then restart `pnpm dev`, open the Listening Room, and choose **Connect Audiotool**. Complete consent in the browser. The SDK validates its PKCE state and callback; Pocket Producer hands the resulting session directly to the loopback API, encrypts it with an automatically generated ignored local key, binds it to the local app owner, and persists refresh rotation. Do not paste access or refresh tokens into chat or `.env`.

The installed Nexus 0.0.17 types and official examples document `project:write` for project creation/editing, but do not publish a separate operation-to-scope declaration for sample upload. The first authorized test must therefore confirm that the registered grant also permits `samples.upload`; if Audiotool returns a scope error, preserve that exact sanitized error and adjust the registered scope only from Audiotool’s own response/documentation.

After consent, explicitly authorize one export from a disposable test revision. The installed Nexus SDK offers `unlisted`, not a private project-creation option, so confirm account visibility before proceeding. Success means Studio opens with four separately editable audio stems aligned at tick 0, the project tempo and time signature match the canonical composition, and the musical body plus explicit tail have the expected duration. It does not imply note-level editability.

## Optional Gemini diagnosis

Do not rerun the retained live verifier. First confirm that this host can reach the configured Gemini endpoint without changing the key or consuming another application identity. If a new bounded verification is desired afterward, authorize a new identity explicitly. The verifier makes at most one source-analysis call and one preview-critique call, never calls OpenAI, and never renders again; the shared US$5 ledger still applies.
