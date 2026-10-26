# EcoGrid zero-dependency local HTTP server (Windows PowerShell).
# Usage:  powershell -ExecutionPolicy Bypass -File scripts/serve.ps1 [-Port 8080]
param(
    [int]$Port = 8080
)

$root = Split-Path -Parent $PSScriptRoot
Write-Host "EcoGrid serving $root at http://localhost:$Port  (Ctrl+C to stop)"

$prefix = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch {
    Write-Error "Could not bind ${prefix}: $_"
    exit 1
}

$mime = @{
    ".html" = "text/html; charset=utf-8"; ".css" = "text/css; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"; ".json" = "application/json"
    ".geojson" = "application/geo+json"; ".svg" = "image/svg+xml"
    ".png" = "image/png"; ".ico" = "image/x-icon"; ".md" = "text/markdown; charset=utf-8"
    ".py" = "text/plain; charset=utf-8"
}

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.AbsolutePath
    if ($path -eq "/") { $path = "/index.html" }
    $file = Join-Path $root ($path -replace "/", "\")
    try {
        if ((Test-Path $file -PathType Leaf) -and ((Resolve-Path $file).Path.StartsWith($root))) {
            $bytes = [System.IO.File]::ReadAllBytes($file)
            $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
            $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
            $ctx.Response.ContentLength64 = $bytes.Length
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $ctx.Response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 not found: $path")
            $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
        }
    } catch {
        Write-Warning "request failed: $_"
    } finally {
        try { $ctx.Response.OutputStream.Close() } catch {}
    }
}
