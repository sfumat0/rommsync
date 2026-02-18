#!/bin/bash
# RommSync AppImage Builder for Steam Deck
# Run this script on your Steam Deck in Desktop Mode

set -e  # Exit on error

echo "=========================================="
echo "RommSync AppImage Builder"
echo "=========================================="
echo ""

# Check if distrobox is available
if ! command -v distrobox &> /dev/null; then
    echo "ERROR: Distrobox not found!"
    echo "Please install distrobox first:"
    echo "  flatpak install flathub io.github.89luca89.distrobox"
    exit 1
fi

# Create build container if it doesn't exist
echo "Creating build container (this may take a few minutes first time)..."
if ! distrobox list | grep -q "rommsync-builder"; then
    distrobox create --name rommsync-builder --image ubuntu:22.04 --yes
fi

echo ""
echo "Entering build container and installing dependencies..."
echo ""

# Build inside distrobox
distrobox enter rommsync-builder -- bash -c '
set -e

# Install build dependencies
echo "Installing build tools..."
sudo apt update
sudo apt install -y python3 python3-pip python3-venv wget fuse

# Install Python dependencies
echo "Installing Python packages..."
pip3 install pyinstaller

# Create build directory
cd /tmp
rm -rf rommsync-build
mkdir -p rommsync-build
cd rommsync-build

# Copy application files from host
echo "Copying application files..."
cp -r /home/deck/romm-sync/app .
cp /home/deck/romm-sync/requirements.txt .
cp /home/deck/romm-sync/config.yaml .

# Install app requirements
pip3 install -r requirements.txt

# Add pip bin to PATH
export PATH="$HOME/.local/bin:$PATH"

# Create PyInstaller spec file
echo "Creating build configuration..."
cat > rommsync.spec << EOF
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ["app/main.py"],
    pathex=[],
    binaries=[],
    datas=[
        ("app/static", "app/static"),
        ("config.yaml", "."),
    ],
    hiddenimports=[
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="RommSync",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
EOF

# Build executable
echo ""
echo "Building executable (this will take a few minutes)..."
$HOME/.local/bin/pyinstaller --clean rommsync.spec

# Download AppImage runtime
echo ""
echo "Creating AppImage..."
cd dist
wget -q https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage
chmod +x appimagetool-x86_64.AppImage

# Create AppDir structure
mkdir -p RommSync.AppDir/usr/bin
cp RommSync RommSync.AppDir/usr/bin/

# Create AppImage metadata
cat > RommSync.AppDir/RommSync.desktop << DESKTOP
[Desktop Entry]
Type=Application
Name=RommSync
Exec=RommSync
Icon=rommsync
Categories=Utility;Game;
Terminal=true
DESKTOP

# Create simple icon (text-based placeholder)
cat > RommSync.AppDir/rommsync.svg << ICON
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <rect width="256" height="256" fill="#bb66ff"/>
  <text x="128" y="140" font-size="80" text-anchor="middle" fill="white" font-family="Arial">RS</text>
</svg>
ICON

# Create AppRun script
cat > RommSync.AppDir/AppRun << APPRUN
#!/bin/bash
SELF=\$(readlink -f "\$0")
HERE=\${SELF%/*}
export PATH="\${HERE}/usr/bin:\${PATH}"
cd "\${HERE}/usr/bin"
exec "\${HERE}/usr/bin/RommSync" "\$@"
APPRUN
chmod +x RommSync.AppDir/AppRun

# Build AppImage
./appimagetool-x86_64.AppImage RommSync.AppDir RommSync-x86_64.AppImage

# Copy to host home directory
echo ""
echo "Copying AppImage to /home/deck/..."
cp RommSync-x86_64.AppImage /home/deck/RommSync.AppImage
chmod +x /home/deck/RommSync.AppImage

echo ""
echo "=========================================="
echo "BUILD COMPLETE!"
echo "=========================================="
echo ""
echo "AppImage created at: /home/deck/RommSync.AppImage"
echo ""
echo "To run:"
echo "  cd /var/home/deck"
echo "  ./RommSync.AppImage"
echo ""
echo "The app will start on http://localhost:5000"
echo "Open in browser to use!"
echo ""
'

echo ""
echo "=========================================="
echo "Build finished successfully!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Make sure config.yaml is configured"
echo "2. Run: cd /home/deck && ./RommSync.AppImage"
echo "3. Open browser to http://localhost:5000"
echo ""
