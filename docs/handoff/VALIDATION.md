# Package validation

Validated: 2026-09-19T22:49:42.493Z

**Scope: handoff artifacts only. No application, audio engine, live provider, Nexus project, or deployed service was tested.**

- Parsed all JSON files.
- Checked 68 relative Markdown links and 64 syntactically valid external URL references. External availability was not re-tested by this script.
- Checked package Markdown for private absolute user paths and vault-only links.
- Checked the illustrative composition: timing, asset references, sample duration and unique IDs.
- Applied the illustrative scoped patch; protected melody and out-of-scope events remain unchanged. This is not a production patch-engine test.
- Checked that credential placeholders are empty and no actual environment file is packaged.
- Verified selected PNG header/dimensions: 1774 × 887. Its selection and content were also visually inspected during preparation.
- Calculated the specified design-token contrast pairs; this does not prove accessibility of an unbuilt interface.

| Foreground / background | Ratio | Required |
| --- | --- | --- |
| ink / canvas | 14.06:1 | 4.5:1 |
| secondary / canvas | 5.36:1 | 4.5:1 |
| secondary / surface | 5.85:1 | 4.5:1 |
| brandForeground / brand | 5.58:1 | 4.5:1 |
| brand / surface | 5.39:1 | 4.5:1 |
| error / surface | 7.31:1 | 4.5:1 |
| borderInteractive / surface | 3.81:1 | 3:1 |
| focus / canvas | 4.94:1 | 3:1 |

## Re-run

With Node.js available, run from this package folder:

```text
node tools/validate-package.mjs
```

The default run also verifies every file against MANIFEST.json. After deliberately editing this handoff, regenerate its validation report and manifest with `node tools/validate-package.mjs --seal`.

The manifest excludes itself to avoid recursive hashing. ZIP byte/hash verification is performed separately during packaging. Application implementation and all live/device tests remain future work.
