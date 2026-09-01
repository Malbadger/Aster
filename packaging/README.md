# Aster desktop packaging (BUILD-D-022)

Linux-first packaging for the Aster desktop application. Target: **Ubuntu 24.04 LTS**
(OPEN-D-002 provisional). Produces an **AppImage** and a **`.deb`** from locked inputs,
plus **SHA-256** checksums, an **SBOM**, and a license inventory.

This step runs on a real Ubuntu 24.04 machine — it needs the Rust/Tauri toolchain and a
display; the artifacts also exceed what a remote bridge can transfer. The commands below
are what a maintainer runs locally.

## Prerequisites (Ubuntu 24.04)

```bash
# System libraries required by Tauri v2 on Linux
sudo apt update
sudo apt install -y \
  build-essential curl wget file libssl-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev \
  libwebkit2gtk-4.1-dev

# Rust toolchain (stable)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Node 22 (nvm or distro); then, in the repo root:
npm install
```

## Build the packaged application

```bash
# From the repo root
npm run build:all          # BUILD PASS  (Aster Core + shared libs + daemon + desktop frontend)
npm run check:all          # CHECK PASS
npm run desktop:test       # TEST PASS total=<n>
npm run release:audit      # RELEASE AUDIT PASS (secret scan + SBOM + licenses)
npm run desktop:package    # PACKAGE PASS  -> AppImage + .deb + SHA-256 + manifest
```

`desktop:package` emits, under `apps/desktop/src-tauri/target/release/bundle/`:

- `appimage/LAW_<version>_amd64.AppImage`
- `deb/LAW_<version>_amd64.deb`

and writes `work/evidence/law-desktop/package-manifest.json` with each artifact's SHA-256.

## Install (clean Linux user)

AppImage:

```bash
chmod +x LAW_<version>_amd64.AppImage
./LAW_<version>_amd64.AppImage
```

`.deb`:

```bash
sudo apt install ./LAW_<version>_amd64.deb   # resolves dependencies
law                                          # launch from the app menu or the `law` command
```

Uninstall the `.deb`: `sudo apt remove law`.

## Signing / updates (OPEN-D-003, provisional)

This build uses **manual checksummed GitHub releases**. Verify an artifact against the
published SHA-256 before installing. Unsigned **automatic** updates are disabled; the updater
only checks and stages a verified release, never replacing the running one. A production
auto-update path requires a signing identity (HUMAN-D-004) that has not been supplied.

## Icons

`apps/desktop/src-tauri/icons/` must contain the app icons Tauri references. Generate them
from a single source PNG with `npm run tauri icon path/to/icon.png` (a placeholder set is
acceptable for development; a final brand icon depends on OPEN-D-001).
