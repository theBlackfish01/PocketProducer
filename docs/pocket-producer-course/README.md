# Pocket Producer architecture course

Open `index.html` directly, or serve this directory from the repository root:

```powershell
& .\node_modules\.bin\vite.ps1 docs/pocket-producer-course --host 127.0.0.1 --port 4174
```

The course source is split into `modules/*.html`. Reassemble the generated `index.html` after editing a module:

```powershell
& .\docs\pocket-producer-course\build.ps1
```

`build.sh` is retained for Unix environments. The CSS and JavaScript runtime are copied from the codebase-to-course skill; course-specific content lives in `_base.html`, `modules/`, and `briefs/`.
