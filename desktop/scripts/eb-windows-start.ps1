param([Parameter(Mandatory = $true)][string]$Setup, [string]$Shot = "")
$ErrorActionPreference = "Stop"
$stage = Join-Path $env:RUNNER_TEMP ("channels-setup-" + [guid]::NewGuid())
Expand-Archive -LiteralPath $Setup -DestinationPath $stage
$root = Join-Path $env:LOCALAPPDATA "com.kiwiinit.channels\stable"
$launcher = Join-Path $root "app\bin\launcher.exe"
$env:ELECTROBUN_INSTALLER_UI_AUTOCLOSE = "1"
$setupExe = Join-Path $stage "Channels-Setup.exe"
$installer = Start-Process -FilePath $setupExe -WorkingDirectory $stage -PassThru
$problems = @()
for ($i = 0; $i -lt 240 -and -not (Test-Path -LiteralPath $launcher); $i++) { Start-Sleep -Milliseconds 500 }
if (-not (Test-Path -LiteralPath $launcher)) { $problems += "Channels-Setup.exe didn't install $launcher within 120 s" } else { Write-Output "installed: $launcher" }
$installer | Wait-Process -Timeout 120 -ErrorAction SilentlyContinue
Remove-Item Env:ELECTROBUN_INSTALLER_UI_AUTOCLOSE
$find = { Get-Process | Where-Object { $_.MainWindowTitle -eq "Channels" } | Select-Object -First 1 }
$win = & $find
if (-not $win -and (Test-Path -LiteralPath $launcher)) {
  Write-Output "the installer didn't open the app; starting it"
  Start-Process -FilePath $launcher -WorkingDirectory (Split-Path $launcher) -RedirectStandardOutput (Join-Path $stage "app.out") -RedirectStandardError (Join-Path $stage "app.err") | Out-Null
}
for ($i = 0; $i -lt 60 -and -not $win; $i++) { Start-Sleep -Milliseconds 500; $win = & $find }
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
Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Write-Output "process: $($_.ProcessName) pid $($_.Id) window $($_.MainWindowHandle) titled '$($_.MainWindowTitle)'" }
$logs = @(@($root, (Join-Path $env:APPDATA "com.kiwiinit.channels"), (Join-Path $env:LOCALAPPDATA "com.kiwiinit.channels")) | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { Get-ChildItem -LiteralPath $_ -Recurse -Include *.log -ErrorAction SilentlyContinue } | Sort-Object FullName -Unique)
@($logs) + @(Get-ChildItem -LiteralPath $stage -Include app.out, app.err -Recurse -ErrorAction SilentlyContinue) | ForEach-Object { Write-Output "--- $($_.FullName)"; Get-Content $_.FullName -Tail 80 }
Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue
if ($problems.Count) { $problems | ForEach-Object { Write-Output "problem: $_" }; exit 1 }
Write-Output "Channels installed, started on Windows and kept its window"
