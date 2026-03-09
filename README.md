<p align="center">
  <img src="assets/aerogel-logo.svg" alt="Aerogel Logo" width="128" height="128" />
</p>

# Aerogel

AeroSpace-inspired BSP tiling window manager for KDE Plasma 6 on Wayland.

Aerogel is a KWin script that automatically arranges windows in a binary space
partitioning (BSP) layout. Open a window and it fills the screen. Open a
second and the screen splits 50/50 side-by-side. Open a third and one half
splits top/bottom. The pattern continues, alternating horizontal and vertical
splits at each level of the tree.

Also included: **Aerogel Pager**, a compact Plasma panel widget that shows
your current workspace number and lets you switch workspaces and toggle tiling
from a click-to-open dropdown menu.

Written in TypeScript (KWin script) and QML (widget), packaged with Nix.

## How It Works

Each virtual desktop and screen pair maintains its own BSP tree. When a new
window appears, aerogel finds the focused leaf node, splits its cell in half,
and places the new window as a sibling. The split orientation alternates with
tree depth: even depths split horizontally (left/right), odd depths split
vertically (top/bottom).

```
  1 window          2 windows          3 windows
 ┌────────────┐   ┌──────┬──────┐   ┌──────┬──────┐
 │            │   │      │      │   │      │  B   │
 │     A      │   │  A   │  B   │   │  A   ├──────┤
 │            │   │      │      │   │      │  C   │
 └────────────┘   └──────┴──────┘   └──────┴──────┘
```

Configurable inner and outer gaps keep windows visually separated.

## Aerogel Pager Widget

A compact workspace indicator that lives in your Plasma panel.

- **Panel display** -- a single rounded box showing the current workspace number,
  styled to match the active KDE colour scheme (Breeze, Breeze Dark, custom themes)
- **Left-click** -- opens a dropdown menu with:
  - Up to 10 most recently visited workspaces (click to switch)
  - Enable / Disable Aerogel Tiling toggle
  - Configure Virtual Desktops link
- **Mouse wheel** -- cycles through workspaces without opening the menu
- **Right-click** -- reserved for standard Plasma widget management

## Keyboard Shortcuts

All shortcuts use the Super (Meta) key, inspired by AeroSpace's vim-style
navigation.

### Focus Navigation

| Shortcut | Action |
|---|---|
| `Super+H` | Focus left |
| `Super+J` | Focus down |
| `Super+K` | Focus up |
| `Super+L` | Focus right |
| `Super+Left` | Focus left (arrow key) |
| `Super+Down` | Focus down (arrow key) |
| `Super+Up` | Focus up (arrow key) |
| `Super+Right` | Focus right (arrow key) |

### Window Movement

| Shortcut | Action |
|---|---|
| `Super+Shift+H` | Swap window left |
| `Super+Shift+J` | Swap window down |
| `Super+Shift+K` | Swap window up |
| `Super+Shift+L` | Swap window right |
| `Super+Shift+Left` | Swap window left (arrow key) |
| `Super+Shift+Down` | Swap window down (arrow key) |
| `Super+Shift+Up` | Swap window up (arrow key) |
| `Super+Shift+Right` | Swap window right (arrow key) |

### Workspaces

| Shortcut | Action |
|---|---|
| `Super+1`..`9`, `Super+0` | Switch to workspace N (0 = workspace 10) |
| `Super+Shift+1`..`9`, `Super+Shift+0` | Move window to workspace N |
| `Super+Shift+Tab` | Move focused workspace (with windows) to the next monitor; focused monitor falls back to its last used workspace or a new empty one; focus follows |

> **Keyboard layout note:** `Super+Shift+digit` is registered twice -- once as
> `Meta+Shift+N` and once as `Meta+<symbol>` (e.g. `Meta+!` for workspace 1)
> to handle compositors/SPICE that deliver the shifted keysym directly. Only
> **US-EN keyboard layout** is officially supported for these bindings.

### Window Management

| Shortcut | Action |
|---|---|
| `Super+F` | Toggle fullscreen |
| `Super+Q` | Close window |
| `Super+Space` | Toggle float |
| `Super+Minus` | Shrink window (adjust BSP split ratio) |
| `Super+Equal` | Grow window (adjust BSP split ratio) |

## Requirements

- KDE Plasma 6 on Wayland

### Optional: `ydotool` (cursor warping on multi-monitor setups)

On Wayland, `workspace.activeScreen` tracks the screen that the pointer is
currently on -- not the screen that has keyboard focus.  When you switch to a
workspace on a different monitor via `Super+N`, aerogel moves keyboard focus to
that monitor, but without a cursor warp the pointer stays on the old monitor.
This causes the app launcher (`Super` / `Meta` key) and other pointer-screen
features in Plasma to open on the wrong monitor.

Aerogel fixes this by warping the cursor to the centre of the target screen
whenever focus crosses a monitor boundary.  Because KWin scripting has no
built-in cursor-warp API on Wayland, the warp is delegated to
[`ydotool`](https://github.com/ReimuNotMoe/ydotool) through a small D-Bus
helper service (`aerogel-cursor`).

**Without `ydotool`** aerogel works correctly on a single monitor, and
multi-monitor workspace switching still works -- but the pointer will not follow
focus, so pointer-driven Plasma features may open on the wrong screen.

**With `ydotool`** install `aerogel-cursor` (provided by this repo).  It ships
a D-Bus activation file so the session bus starts it automatically on the first
warp call -- no `systemctl enable` needed.  It also auto-starts `ydotoold` on
its first invocation if the socket is absent.

The only manual step is adding your user to the `input` group (required for
`/dev/uinput` access):

```bash
# Arch / CachyOS (ydotool ships the udev rule; just add the group)
sudo usermod -aG input $USER
# Log out and back in (or reboot)

# NixOS -- handled declaratively via the aerogel NixOS module:
# aerogel.enable = true;
# aerogel.users  = [ "youruser" ];
```

When using the Nix VM (`nix run .#vm`), everything is configured automatically.

## Packages

Aerogel is split into independent packages that can be installed separately or
together. The naming is consistent across Nix and AUR.

| Package | What it provides |
|---|---|
| **`aerogel`** | Meta-package -- installs all components below |
| `kwin-scripts-aerogel` | BSP tiling KWin script |
| `plasma6-applets-aerogel-pager` | Plasma panel workspace pager widget |
| `aerogel-cursor` | D-Bus cursor-warp service for multi-monitor Wayland (requires `ydotool`) |
| `aerogel-icons` | Custom icon for KDE integration (hicolor icon theme) |

## Installation

### Nix (flake -- recommended)

Add aerogel as a flake input, then use the provided NixOS and home-manager
modules for a fully declarative setup including cursor warping:

```nix
# flake.nix
inputs.aerogel = {
  url = "github:youruser/aerogel";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

```nix
# configuration.nix (NixOS system config)
# Sets up /dev/uinput udev rule + adds users to the input group for ydotool.
imports = [ inputs.aerogel.nixosModules.default ];
aerogel.enable = true;
aerogel.users  = [ "youruser" ];
```

```nix
# home.nix (home-manager)
# Installs KWin script, widget, aerogel-cursor; enables the script in kwinrc.
imports = [ inputs.aerogel.homeManagerModules.default ];
aerogel.enable     = true;
aerogel.cursorWarp = true;   # default: true -- requires ydotool + input group
aerogel.innerGap   = 8;      # default: 8
aerogel.outerGap   = 8;      # default: 8
```

#### Manual flake install (without modules)

```nix
# home.nix
{ inputs, pkgs, ... }:
{
  home.packages = [ inputs.aerogel.packages.${pkgs.system}.default ];

  programs.plasma.configFile.kwinrc = {
    Plugins.aerogelEnabled = true;
    Script-aerogel.innerGap = 8;
    Script-aerogel.outerGap = 8;
  };
}
```

Individual packages:

```nix
inputs.aerogel.packages.${pkgs.system}.kwin-scripts-aerogel          # KWin script only
inputs.aerogel.packages.${pkgs.system}.plasma6-applets-aerogel-pager  # Plasma widget only
inputs.aerogel.packages.${pkgs.system}.aerogel-cursor                 # cursor warp service
inputs.aerogel.packages.${pkgs.system}.aerogel-icons                  # hicolor icon
```

### Nix (standalone / no flake)

```bash
# Install everything (KWin script + widget + cursor + icon)
nix profile install github:youruser/aerogel

# Or install individually
nix profile install github:youruser/aerogel#kwin-scripts-aerogel
nix profile install github:youruser/aerogel#plasma6-applets-aerogel-pager
nix profile install github:youruser/aerogel#aerogel-cursor
nix profile install github:youruser/aerogel#aerogel-icons
```

### Arch Linux (AUR)

```bash
# Install everything
yay -S aerogel

# Or install individually
yay -S kwin-scripts-aerogel
yay -S plasma6-applets-aerogel-pager
yay -S aerogel-cursor    # optional: cursor warping (pulls in ydotool, python-dbus, python-gobject)
yay -S aerogel-icons     # optional: custom icon in KDE settings / widget explorer
```

After installing, add your user to the `input` group if using `aerogel-cursor`:

```bash
sudo usermod -aG input $USER
# Log out and back in
```

Then enable the script in System Settings → Window Management → KWin Scripts,
or via terminal:

```bash
kwriteconfig6 --file kwinrc --group Plugins --key aerogelEnabled true
qdbus org.kde.KWin /KWin reconfigure
```

### KDE Store

The KWin script and widget are available on the KDE Store:

- **KWin script:** System Settings → Window Management → KWin Scripts →
  "Get New KWin Scripts..." → search for "Aerogel"
- **Widget:** Right-click panel → "Add Widgets..." → "Get New Widgets..." →
  search for "Aerogel Pager"

> **Note:** The KDE Store installation does not include the custom icon
> (`aerogel-icons`) or cursor warp service (`aerogel-cursor`). For the full
> experience including the Aerogel icon in System Settings and the widget
> explorer, install `aerogel-icons` separately from the AUR or via Nix.

### Manual (non-Nix)

**Requirements:** Node.js 20+, `kpackagetool6` (part of KDE Frameworks)

```bash
# Clone the repo
git clone https://codeberg.org/youruser/aerogel.git
cd aerogel

# Install the KWin tiling script
npm install
npm run build
kpackagetool6 --type KWin/Script -i package/

# Install the Plasma pager widget
kpackagetool6 --type Plasma/Applet -i widget/package/
```

Then enable the script in System Settings → Window Management → KWin Scripts,
or via terminal:

```bash
kwriteconfig6 --file kwinrc --group Plugins --key aerogelEnabled true
qdbus org.kde.KWin /KWin reconfigure
```

To add the widget to your panel: right-click the panel → Add Widgets →
search for "Aerogel Pager".

### Uninstall

```bash
# Nix (profile)
nix profile remove github:youruser/aerogel

# Arch Linux (AUR)
yay -R aerogel   # or remove individual packages

# Manual (kpackagetool)
kpackagetool6 --type KWin/Script -r aerogel
kpackagetool6 --type Plasma/Applet -r org.aerogel.pager
```

## Configuration

Aerogel reads its configuration from KWin's script config system. The defaults
can be overridden in System Settings or via `kwriteconfig6`.

| Key | Default | Description |
|---|---|---|
| `innerGap` | `8` | Pixels between adjacent windows |
| `outerGap` | `8` | Pixels between windows and screen edges |

## Current Status

- **BSP layout** -- windows tile automatically in alternating H/V splits
- **Wayland native** -- handles async geometry, maximized windows, panel loading
- **Per-monitor workspaces** -- AeroSpace-style: each monitor has its own active workspace; `Super+Shift+Tab` moves the focused workspace (with its windows) to the next monitor, restoring the monitor's last-used workspace or a new empty one; cursor warps to the target monitor on focus switch (requires `ydotool`)
- **Keyboard shortcuts** -- vim-style and arrow-key focus/swap, workspace switching, fullscreen, close, float, resize
- **Float toggle** -- `Super+Space` exempts a window from tiling (floats above, centred)
- **Fullscreen** -- `Super+F` toggles fullscreen; fullscreen windows are untiled and retiled on restore
- **Interactive resize** -- drag to resize adjusts the BSP split ratio; `Super+Minus`/`Super+Equal` nudge it from the keyboard
- **Plasma pager widget** -- compact panel indicator showing the current workspace number, with a dropdown to switch workspaces and toggle tiling

### Known Limitations

- No configuration UI (gaps are set via `kwriteconfig6` only)
- No window rule system (per-app float/tile overrides)
- No layout mode switching (BSP only -- no stacking or monocle modes)
- US-EN keyboard layout assumed for `Super+Shift+digit` bindings

## Development

### Requirements

- Nix with flakes enabled (or direnv)

### Quick Start

```bash
# Enter the dev environment
nix develop   # or: direnv allow

# Build the TypeScript
nix run .#build

# Launch the test VM (KDE Plasma 6, SPICE display, shared clipboard)
nix run .#vm

# In another terminal: deploy both script and widget to the running VM
nix run .#vm-deploy
```

### Nix Commands

#### Build

| Command | Description |
|---|---|
| `nix run .#build` | Compile TypeScript to `package/contents/code/main.js` |
| `nix run .#clean` | Remove compiled output |

#### Install on host

| Command | Description |
|---|---|
| `nix run .#install` | Build + install KWin script + widget |
| `nix run .#reinstall` | Build + upgrade KWin script + widget |
| `nix run .#uninstall` | Remove KWin script + widget |
| `nix run .#kwin-script-install` | Build + install KWin script only |
| `nix run .#kwin-script-reinstall` | Build + upgrade KWin script only |
| `nix run .#kwin-script-uninstall` | Remove KWin script only |
| `nix run .#widget-install` | Install Plasma pager widget only |
| `nix run .#widget-reinstall` | Upgrade Plasma pager widget only |
| `nix run .#widget-uninstall` | Remove Plasma pager widget only |
| `nix run .#aerogel-enable` | Back up and clear conflicting KDE shortcuts |
| `nix run .#aerogel-disable` | Restore original KDE shortcuts from backup |

#### Test VM

| Command | Description |
|---|---|
| `nix run .#vm` | Launch ephemeral test VM (SPICE display, clipboard sharing) |
| `nix run .#vm-ssh` | SSH into the running VM |
| `nix run .#kill-vm` | Kill QEMU + remote-viewer |
| `nix run .#vm-deploy` | Deploy KWin script + widget to running VM |
| `nix run .#vm-deploy-kwin-script` | Deploy KWin script only to running VM |
| `nix run .#vm-deploy-widget` | Deploy widget only to running VM |

### Edit-Test Loop

```bash
# 1. Edit TypeScript in src/ or QML in widget/
# 2. Deploy and restart (one command)
nix run .#vm-deploy
# 3. Check KWin script logs
nix run .#vm-ssh -- "journalctl --user -b | grep '\[aerogel\]' | tail -20"
```

The VM is ephemeral -- every `nix run .#vm` starts from a clean state. Changes
deployed via `vm-deploy` go to `~/.local/share/` which overrides the Nix store
path. For changes to survive a fresh VM boot, they must be committed and the
Nix package rebuilt.

### Project Structure

```
src/                             KWin script TypeScript source
  main.ts                        Entry point (autoStart IIFE)
  config/Config.ts               Typed config loader (innerGap, outerGap)
  layout/BSPLayout.ts            Recursive BSP layout calculator
  layout/GapConfig.ts            Gap configuration
  tree/Node.ts                   Abstract BSP tree node
  tree/Container.ts              Internal node (orientation + two children)
  tree/WindowNode.ts             Leaf node (wraps a KWin window)
  tree/Tree.ts                   BSP tree per (desktop, screen) pair
  manager/WorkspaceManager.ts    Signal wiring, tiling orchestration
  manager/WindowFilter.ts        Window eligibility checks
  shortcuts/Shortcuts.ts         Keyboard shortcut registration
  shortcuts/ShortcutConflictManager.ts  KGlobalAccel cleanup on destroy
  extern/kwin.d.ts               KWin 6 type declarations
package/                         KWin script KPackage
  metadata.json                  KPackage metadata (KWin/Script)
  contents/code/main.js          Compiled output (gitignored)
  contents/config/main.xml       KConfig schema
widget/                          Plasma pager widget
  package/
    metadata.json                KPackage metadata (Plasma/Applet, ID: org.aerogel.pager)
    contents/ui/
      main.qml                   PlasmoidItem root -- D-Bus helpers, dropdown menu, toggle logic
      CompactRep.qml             Panel display -- NumberBox + mouse/wheel handling
      NumberBox.qml              Themed rounded rectangle with workspace label
      FullRep.qml                Workspace grid (present but not used in current flow)
scripts/
  aerogel-cursor.py              D-Bus cursor warp service (ydotool)
assets/
  aerogel-logo.svg               Standalone SVG logo (dark background)
  aerogel-logo.png               512x512 PNG render (for KDE Store)
aur/
  PKGBUILD                       AUR split package (5 packages)
nix/                             Nix packaging and tooling
  package.nix                    buildNpmPackage → kwin-scripts-aerogel
  widget.nix                     stdenvNoCC → plasma6-applets-aerogel-pager
  cursor.nix                     stdenvNoCC → aerogel-cursor (D-Bus + systemd)
  icons.nix                      stdenvNoCC → aerogel-icons (hicolor SVG)
  hm-module.nix                  home-manager module (aerogel.enable, cursorWarp, gaps)
  nixos-module.nix               NixOS module (udev rule, input group)
  apps.nix                       All nix run .#<app> definitions
  devshell.nix                   Dev environment (nix develop / direnv)
  pkgs.nix                       Shared nixpkgs import
  vm/
    default.nix                  NixOS VM config (KDE Plasma 6, autologin, dual monitors)
    home.nix                     home-manager config for the VM
```

## License

[GPL-3.0-or-later](LICENSE)
