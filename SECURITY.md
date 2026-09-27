# Security and private development

Pocket Producer is a loopback-only development preview, not a production-hardened public service. Do not expose the API or development server through a public tunnel. The development identity is shared; an Audiotool avatar is not multi-user application authentication.

## Keep private material out of Git

- Store provider credentials in the ignored root `.env`; never use `VITE_*` for a secret.
- `.local/` contains private source assets, fixtures, diagnostic traces and the OAuth encryption key. Do not publish or attach that directory.
- Raw LangSmith exports may contain full directions, tool inputs/outputs and private resource metadata. Trace payload hiding defaults to enabled; enabling payload capture is an explicit privacy choice.
- Screenshots for documentation must use isolated test data. Inspect them before publishing.
- The PostgreSQL volume, encrypted OAuth sessions and local encryption key are not part of the repository. Back them up privately and together when needed.

## Safety boundaries

Owner checks, immutable versions, protected-material validation, worker fencing and the effect ledger remain authoritative over model proposals. Shared/provider/user/job spending caps apply together; unknown outcomes retain a hold and cannot be made safe by changing an idempotency key. Never reset usage to make a job continue.

Ordinary tests use fixture/scripted providers with credentials and tracing disabled. Never add live credentials to GitHub Actions merely to make a test pass.

## Reporting a concern

While the repository is private, report concerns to its owner through the private repository's collaboration channel. Do not include tokens, raw provider traces, private audio or personal data in an issue. For an accidental credential disclosure, stop using the exposed credential and use the provider's revocation/rotation process; deleting a file in the latest commit does not remove it from Git history.

A private repository and a heuristic secret scan are not substitutes for a full security review before public deployment.
