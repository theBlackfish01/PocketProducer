# Remaining user setup

Only Audiotool registration/consent is missing for the local milestone. OpenAI and Gemini credentials are already present; do not create or paste replacement keys.

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

After consent, run one export from a private test revision. Success means Studio opens with four separately editable audio stems aligned at tick 0 and the project tempo matches the canonical composition. It does not imply note-level editability.
