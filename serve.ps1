# Minimal static file server for the Phase 0 web prototype (Windows, no installs needed).
# Serves this folder at http://localhost:8080/ . Stop with Ctrl+C.
# Use -Lan to also serve on the home network (for the phone later); that needs an elevated
# PowerShell once, or Windows will refuse to bind to the network address.
param([int]$Port = 8080, [switch]$Lan)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$prefix = if ($Lan) { "http://+:$Port/" } else { "http://localhost:$Port/" }
$types = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.mjs'='text/javascript; charset=utf-8'
  '.json'='application/json; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.png'='image/png'
  '.webp'='image/webp'; '.svg'='image/svg+xml'; '.pmtiles'='application/octet-stream'; '.pbf'='application/x-protobuf'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch {
  Write-Host "Could not start on $prefix : $($_.Exception.Message)" -ForegroundColor Red
  if ($Lan) { Write-Host "For -Lan, run PowerShell as Administrator once." }
  exit 1
}
Write-Host "Serving $root"
Write-Host "Open: http://localhost:$Port/site/" -ForegroundColor Green
Start-Process "http://localhost:$Port/site/"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
  if (-not $path.StartsWith($root)) { $ctx.Response.StatusCode = 403; $ctx.Response.Close(); continue }
  if (Test-Path $path -PathType Container) { $path = Join-Path $path 'index.html' }
  if (Test-Path $path -PathType Leaf) {
    $bytes = [IO.File]::ReadAllBytes($path)
    $ext = [IO.Path]::GetExtension($path).ToLower()
    $ctx.Response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
    $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $ctx.Response.StatusCode = 404 }
  $ctx.Response.Close()
}
