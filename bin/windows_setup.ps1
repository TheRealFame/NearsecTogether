# NearsecTogether - Windows Automated Setup
$ErrorActionPreference = "Stop"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "   NearsecTogether Windows Setup Utility" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Windows support is currently experimental."

# 1. Check for Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "[✓] Node.js is installed" -ForegroundColor Green
} else {
    Write-Host "[!] Node.js NOT found. Please install from https://nodejs.org/" -ForegroundColor Red
    exit
}

# 2. Check for Python
if (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Host "[✓] Python is installed" -ForegroundColor Green
} else {
    Write-Host "[!] Python NOT found. Install and check 'Add to PATH'." -ForegroundColor Red
    exit
}

# 3. Install ViGEmBus (Crucial for Gamepad support)
$vigemCheck = Get-PnpDevice -FriendlyName "ViGEmBus Device" -ErrorAction SilentlyContinue
if ($vigemCheck) {
    Write-Host "[✓] ViGEmBus driver is already installed." -ForegroundColor Green
} else {
    $installVigem = Read-Host "ViGEmBus driver (Gamepad support) not found. Download it now? (y/n)"
    if ($installVigem -eq 'y') {
        Write-Host "Downloading ViGEmBus installer..." -ForegroundColor Yellow
        $url = "https://github.com/nefarius/ViGEmBus/releases/latest/download/ViGEmBus_Setup.exe"
        Invoke-WebRequest -Uri $url -OutFile "ViGEmBus_Setup.exe"
        Write-Host "Starting installer. Please complete the setup and REBOOT after this script." -ForegroundColor Cyan
        Start-Process "ViGEmBus_Setup.exe" -Wait
        Remove-Item "ViGEmBus_Setup.exe"
    }
}

# 4. Install Dependencies
Write-Host "`nInstalling Dependencies..." -ForegroundColor Yellow
pip install -r bin/requirements-windows.txt
npm install

# 5. Tunnel Selection Menu
Write-Host "`n------------------------------------------------"
Write-Host "Select a Tunnel Provider for Remote Play:"
Write-Host "------------------------------------------------"
Write-Host "1) Cloudflare (via winget)"
Write-Host "2) Zrok 2 (Automated Install)"
Write-Host "3) Playit.gg (via winget)"
Write-Host "4) None / Skip"

$choice = Read-Host "`nSelect an option (1-4)"

switch ($choice) {
    '1' { winget install --id Cloudflare.cloudflared }
    '2' {
        $zrokUrl = "https://github.com/openziti/zrok/releases/latest/download/zrok_0.6.41_windows_amd64.zip"
        Invoke-WebRequest -Uri $zrokUrl -OutFile "zrok.zip"
        Expand-Archive -Path "zrok.zip" -DestinationPath "$HOME\zrok" -Force
        Remove-Item "zrok.zip"
        Write-Host "[✓] Zrok installed to $HOME\zrok" -ForegroundColor Green
    }
    '3' { winget install --id Playit.Playit }
    '4' { Write-Host "Skipping tunnels." }
}

Write-Host "`nSetup Complete! Run: npm run electron" -ForegroundColor Cyan
pause
