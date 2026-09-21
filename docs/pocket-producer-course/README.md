# Pocket Producer architecture course

Content is current through the 2026-09-21 F1–F8/A1–A6 repair pass applied after runtime `010969f` and course commit `25913b9`. The six modules cover project-safe browser receipts, worker attempt fencing and restart recovery, the bounded Deep Agent, candidate-preserving audio repair, conservative provider accounting, and the Nexus v3 timing/recovery boundary.

Open `index.html` directly, or serve this directory from the repository root:

```powershell
& .\node_modules\.bin\vite.ps1 docs/pocket-producer-course --host 127.0.0.1 --port 4174
```

The course source is split into `modules/*.html`. Reassemble the generated `index.html` after editing a module:

```powershell
& .\docs\pocket-producer-course\build.ps1
```

`build.sh` is retained for Unix environments. The CSS and JavaScript runtime are copied from the codebase-to-course skill; course-specific content lives in `_base.html`, `modules/`, and `briefs/`.
