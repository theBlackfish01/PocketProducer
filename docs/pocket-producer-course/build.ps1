$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$modules = Get-ChildItem -LiteralPath (Join-Path $here "modules") -Filter "*.html" | Sort-Object Name
$parts = @((Join-Path $here "_base.html")) + @($modules.FullName) + @((Join-Path $here "_footer.html"))
$content = ($parts | ForEach-Object { Get-Content -LiteralPath $_ -Raw }) -join ""
$output = Join-Path $here "index.html"
[System.IO.File]::WriteAllText($output, $content, [System.Text.UTF8Encoding]::new($false))
Write-Output "Built index.html — open it in your browser."
