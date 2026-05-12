$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
}

Write-Host '--- Nearsec Automated Setup ---' -ForegroundColor Cyan

if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node missing. Downloading...' -ForegroundColor Yellow
    Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.12.2/node-v20.12.2-x64.msi' -OutFile 'n.msi'
    Start-Process 'msiexec.exe' -ArgumentList '/i n.msi /quiet' -Wait
    Remove-Item 'n.msi'
    Refresh-Path
}

if (!(Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host 'Python missing. Downloading...' -ForegroundColor Yellow
    Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.11.8/python-3.11.8-amd64.exe' -OutFile 'p.exe'
    Start-Process 'p.exe' -ArgumentList '/quiet InstallAllUsers=0 PrependPath=1' -Wait
    Remove-Item 'p.exe'
    Refresh-Path
}

$vigemCheck = Get-PnpDevice -FriendlyName 'ViGEmBus Device' -ErrorAction SilentlyContinue
if (!$vigemCheck) {
    $ans = Read-Host 'ViGEmBus driver not found. Install now? y/n'
    if ($ans -eq 'y') {
        Write-Host 'Launching local ViGEmBus installer...' -ForegroundColor Yellow
        Start-Process '.\ViGEmBus_Setup.exe' -Wait
        Write-Host 'Please ensure you completed the installer.' -ForegroundColor Cyan
    }
} else {
    Write-Host '[✓] ViGEmBus driver is ready' -ForegroundColor Green
}

Write-Host 'Installing Python dependencies...' -ForegroundColor Yellow
pip install -r requirements-windows.txt

Write-Host 'Installing Node packages...' -ForegroundColor Yellow
Set-Location ..
npm install
Set-Location bin

$choice = Read-Host 'Tunnel? 1:Cloudflare 2:Zrok 3:Playit 4:Skip'
if ($choice -eq '1') { Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile "$HOME\cloudflared.exe" }
if ($choice -eq '2') {
    Invoke-WebRequest -Uri 'https://github.com/openziti/zrok/releases/latest/download/zrok_0.6.41_windows_amd64.zip' -OutFile 'z.zip'
    Expand-Archive -Path 'z.zip' -DestinationPath "$HOME\zrok" -Force
    Remove-Item 'z.zip'
}
if ($choice -eq '3') { Invoke-WebRequest -Uri 'https://github.com/playit-cloud/playit-agent/releases/latest/download/playit-windows-x86_64.exe' -OutFile "$HOME\playit.exe" }

Write-Host 'Done!' -ForegroundColor Cyan
pause
