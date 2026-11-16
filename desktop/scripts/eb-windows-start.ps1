param([Parameter(Mandatory = $true)][string]$App, [string]$Shot = "")
$ErrorActionPreference = "Stop"
$home2 = Join-Path $env:RUNNER_TEMP ("channels-start-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $home2 | Out-Null
$env:LOCALAPPDATA = Join-Path $home2 "Local"
$env:APPDATA = Join-Path $home2 "Roaming"
$launcher = Join-Path $App "bin\launcher.exe"
$p = Start-Process -FilePath $launcher -WorkingDirectory (Join-Path $App "bin") -PassThru
$win = $null
for ($i = 0; $i -lt 60 -and -not $win; $i++) {
  Start-Sleep -Milliseconds 500
  $win = Get-Process | Where-Object { $_.MainWindowTitle -eq "Channels" } | Select-Object -First 1
}
$problems = @()
if (-not $win) { $problems += "no window titled Channels within 30 s" } else { Write-Output "window: $($win.ProcessName) pid $($win.Id) titled $($win.MainWindowTitle)" }
Start-Sleep -Seconds 8
if ($win -and -not (Get-Process -Id $win.Id -ErrorAction SilentlyContinue)) { $problems += "the window's process quit within 8 s" }
if ($Shot) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save($Shot, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "screenshot: $Shot"
}
Get-ChildItem -Path $env:LOCALAPPDATA -Recurse -Filter *.log -ErrorAction SilentlyContinue | ForEach-Object { Write-Output "--- $($_.FullName)"; Get-Content $_.FullName -Tail 40 }
Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($App) } | Stop-Process -Force -ErrorAction SilentlyContinue
if ($problems.Count) { $problems | ForEach-Object { Write-Output "problem: $_" }; exit 1 }
Write-Output "Channels started on Windows and kept its window"
