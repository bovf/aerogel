# nix/apps.nix
#
# Flake apps -- invoke with `nix run .#<name>` from the repo root.
#
# Available on all systems
# ────────────────────────
#   nix run .#build                    compile TypeScript → package/contents/code/main.js
#   nix run .#clean                    remove compiled output
#
# Available on Linux only (require kpackagetool6 / KWin / Plasma)
# ───────────────────────────────────────────────────────────────
#   KWin script
#   nix run .#kwin-script-install      build + install KWin script
#   nix run .#kwin-script-reinstall    build + upgrade KWin script
#   nix run .#kwin-script-uninstall    remove KWin script
#
#   Widget
#   nix run .#widget-install           install Plasma pager widget
#   nix run .#widget-reinstall         upgrade Plasma pager widget
#   nix run .#widget-uninstall         remove Plasma pager widget
#
#   Combined (KWin script + widget)
#   nix run .#install                  build + install both
#   nix run .#reinstall                build + upgrade both
#   nix run .#uninstall                remove both
#
#   Test VM
#   nix run .#vm                       launch ephemeral KDE Plasma 6 VM (SPICE display)
#   nix run .#vm-ssh                   SSH into the running VM
#   nix run .#kill-vm                  stop the VM
#
#   VM quick-deploy (build + push + restart)
#   nix run .#vm-deploy                deploy KWin script + widget to running VM
#   nix run .#vm-deploy-kwin-script    deploy only KWin script to running VM
#   nix run .#vm-deploy-widget         deploy only widget to running VM
#
# vmBin: the NixOS VM build output (null on non-Linux systems).
{ pkgs, vmBin ? null }:

let
  mkApp = name: runtimeDeps: text: {
    type = "app";
    program = toString (
      pkgs.writeShellApplication {
        inherit name text;
        runtimeInputs = runtimeDeps;
      }
    ) + "/bin/${name}";
  };

  # ── Shared fragments ─────────────────────────────────────────────────────────

  # cd to the repo root (where package.json lives).
  cdRepo = ''
    REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    cd "$REPO_ROOT"
  '';

  npm    = "${pkgs.nodejs}/bin/npm";
  kpt    = "${pkgs.kdePackages.kpackage}/bin/kpackagetool6";
  kwrite = "${pkgs.kdePackages.kconfig}/bin/kwriteconfig6";
  kread  = "${pkgs.kdePackages.kconfig}/bin/kreadconfig6";

  # ── SSH / SCP helpers ────────────────────────────────────────────────────────
  # All VM operations share the same key and options.
  # Note: ssh uses -p (lowercase) for port; scp uses -P (uppercase).

  sshKey  = "nix/vm/ssh_host_key";
  sshPort = "2222";
  sshHost = "aerogel@localhost";

  # Options for `ssh` (lowercase -p for port)
  sshOpts = "-i ${sshKey} -p ${sshPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR";

  # Options for `scp` (uppercase -P for port)
  scpOpts = "-i ${sshKey} -P ${sshPort} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR";

  # Run a command on the VM via SSH.
  vmRun = cmd: ''
    ssh ${sshOpts} ${sshHost} "${cmd}"
  '';

  # Copy a local file/dir to the VM via SCP.
  vmCopy = local: remote: ''
    scp ${scpOpts} -r ${local} ${sshHost}:${remote}
  '';

  # ── Build fragment ────────────────────────────────────────────────────────────

  buildText = ''
    ${cdRepo}
    ${npm} run build
  '';

  # ── Shortcut conflict management ─────────────────────────────────────────────
  # Aerogel claims Meta+H/J/K/L, Meta+Shift+H/J/K/L, Meta+1-9/0, Meta+Shift+1-9/0,
  # Meta+Space, Meta+Tab.  These fragments back up / restore the conflicting KDE
  # defaults that occupy those keys.
  #
  # Format per entry: "group|key|display-name".
  # kglobalshortcutsrc value format: "current,default,friendly name".
  # "none" clears the current binding while preserving the default column.

  enableShortcutOps = ''
    BACKUP="$HOME/.config/aerogel-shortcuts-backup.ini"
    echo "[aerogel-backup]" > "$BACKUP"

    backup_and_clear() {
      local group="$1" key="$2" clear_value="$3"
      local cur
      cur="$(${kread} --file kglobalshortcutsrc --group "$group" --key "$key" 2>/dev/null || echo "")"
      printf '%s\n' "''${group}///''${key}=''${cur}" >> "$BACKUP"
      if [ -n "$cur" ]; then
        local new_value
        new_value="none,$(echo "$cur" | cut -d',' -f2-)"
        ${kwrite} --file kglobalshortcutsrc --group "$group" --key "$key" "$new_value"
      else
        ${kwrite} --file kglobalshortcutsrc --group "$group" --key "$key" "$clear_value"
      fi
    }

    # Meta+L: "Lock Session"
    backup_and_clear "ksmserver" "Lock Session"     "none,Meta+L,Lock Session"
    # Meta+0: "Zoom to Actual Size"
    backup_and_clear "kwin"      "view_actual_size" "none,Meta+0,Toggle Window Size"
    # Meta+Left/Right: quick tile left/right
    backup_and_clear "kwin" "Window Quick Tile Left"  "none,Meta+Left,Quick Tile Window to the Left"
    backup_and_clear "kwin" "Window Quick Tile Right" "none,Meta+Right,Quick Tile Window to the Right"
    # Meta+Up/Down: maximize/minimize
    backup_and_clear "kwin" "Window Maximize" "none,Meta+Up,Maximize Window"
    backup_and_clear "kwin" "Window Minimize" "none,Meta+Down,Minimize Window"
    # Meta+Shift+arrows: quick-tile corners/edges
    backup_and_clear "kwin" "Window Quick Tile Top"          "none,Meta+Shift+Up,Quick Tile Window to the Top"
    backup_and_clear "kwin" "Window Quick Tile Bottom"       "none,Meta+Shift+Down,Quick Tile Window to the Bottom"
    backup_and_clear "kwin" "Window Quick Tile Top Left"     "none,,Quick Tile Window to the Top Left"
    backup_and_clear "kwin" "Window Quick Tile Top Right"    "none,,Quick Tile Window to the Top Right"
    backup_and_clear "kwin" "Window Quick Tile Bottom Left"  "none,,Quick Tile Window to the Bottom Left"
    backup_and_clear "kwin" "Window Quick Tile Bottom Right" "none,,Quick Tile Window to the Bottom Right"
    # Meta+1..9,0: plasmashell task manager entries
    for i in 1 2 3 4 5 6 7 8 9 10; do
      digit="$i"
      [ "$i" -eq 10 ] && digit="0"
      backup_and_clear "plasmashell" "activate task manager entry $i" "none,Meta+$digit,Activate Task Manager Entry $i"
    done
    # Meta+Minus / Meta+= : KWin zoom shortcuts
    backup_and_clear "kwin" "view_zoom_out" "none,Meta+-,Zoom Out"
    backup_and_clear "kwin" "view_zoom_in"  "none,Meta++,Zoom In"

    # Meta+Shift+Tab: "Walk Through Windows (Reverse)" -- remove Meta+Shift+Tab
    # from both current and default columns so aerogel can claim the key.
    # Meta+Tab ("Walk Through Windows") is intentionally left alone.
    cur_wtr="$(${kread} --file kglobalshortcutsrc --group kwin --key "Walk Through Windows (Reverse)" 2>/dev/null || echo "")"
    printf '%s\n' "kwin///Walk Through Windows (Reverse)=''${cur_wtr}" >> "$BACKUP"
    # Format: "current,default,friendly-name"
    # Both current and default set to Alt+Shift+Tab only -- Meta+Shift+Tab fully removed.
    ${kwrite} --file kglobalshortcutsrc --group kwin \
      --key "Walk Through Windows (Reverse)" \
      "Alt+Shift+Tab,Alt+Shift+Tab,Walk Through Windows (Reverse)"

    dbus-send --session --dest=org.kde.kglobalaccel /kglobalaccel \
      org.kde.KGlobalAccel.reloadConfig 2>/dev/null || true

    echo "aerogel: shortcut conflicts cleared (backup: $BACKUP)"
  '';

  disableShortcutOps = ''
    BACKUP="$HOME/.config/aerogel-shortcuts-backup.ini"
    if [ ! -f "$BACKUP" ]; then
      echo "aerogel: no backup file found at $BACKUP -- nothing to restore"
    else
      while IFS='=' read -r raw_key raw_value; do
        case "$raw_key" in
          \[*\]|"") continue ;;
        esac
        group="$(echo "$raw_key" | cut -d'/' -f1)"
        key="$(echo "$raw_key" | sed 's|.*/||')"
        if [ -n "$raw_value" ]; then
          ${kwrite} --file kglobalshortcutsrc --group "$group" --key "$key" "$raw_value"
        fi
      done < "$BACKUP"

      rm -f "$BACKUP"

      dbus-send --session --dest=org.kde.kglobalaccel /kglobalaccel \
        org.kde.KGlobalAccel.reloadConfig 2>/dev/null || true

      echo "aerogel: shortcut bindings restored"
    fi
  '';

  # ── Common runtime dep sets ───────────────────────────────────────────────────

  baseDeps    = [ pkgs.nodejs pkgs.git ];
  sshDeps     = [ pkgs.openssh ];
  kptDeps     = [ pkgs.kdePackages.kpackage ];
  kconfDeps   = [ pkgs.kdePackages.kconfig pkgs.dbus ];

in
{
  # ── cross-platform ────────────────────────────────────────────────────────────

  build = mkApp "aerogel-build" baseDeps buildText;

  clean = mkApp "aerogel-clean" [ pkgs.git ] ''
    ${cdRepo}
    rm -f package/contents/code/main.js
    echo "aerogel: cleaned compiled output"
  '';


  # ── Linux only ────────────────────────────────────────────────────────────────
} // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {

  # ── VM ────────────────────────────────────────────────────────────────────────

  vm = {
    type = "app";
    program = toString (pkgs.writeShellApplication {
      name = "aerogel-vm";
      runtimeInputs = [ pkgs.virt-viewer ];
      text = ''
        rm -f aerogel-test.qcow2

        SPICE_SOCK="''${XDG_RUNTIME_DIR:-/tmp}/aerogel-spice.sock"
        rm -f "$SPICE_SOCK"

        # Memory, CPUs, and display devices (dual QXL) are set in
        # nix/vm/default.nix via virtualisation.qemu.options.
        # We only add the SPICE transport here so remote-viewer can connect.
        # remote-viewer opens one window per QXL device automatically.
        export QEMU_OPTS="-spice addr=$SPICE_SOCK,unix=on,disable-ticketing=on \
          -display none"
        export QEMU_NET_OPTS="hostfwd=tcp::2222-:22"

        echo ""
        echo "  nix run .#vm-ssh   -- to open a shell inside the VM"
        echo ""

        (
          for _ in $(seq 1 20); do
            [ -S "$SPICE_SOCK" ] && break
            sleep 0.5
          done
          remote-viewer "spice+unix://$SPICE_SOCK" &
        ) &

        exec ${vmBin}/bin/run-aerogel-test-vm
      '';
    }) + "/bin/aerogel-vm";
  };

  vm-ssh = mkApp "aerogel-vm-ssh" (baseDeps ++ sshDeps) ''
    ${cdRepo}
    exec ssh ${sshOpts} ${sshHost} "$@"
  '';

  kill-vm = mkApp "aerogel-kill-vm" [ pkgs.procps ] ''
    pkill -f 'run-aerogel-test-vm' 2>/dev/null || true
    pkill -f 'qemu.*aerogel-test'  2>/dev/null || true
    pkill -f 'remote-viewer.*aerogel-spice' 2>/dev/null || true
    echo "aerogel: VM stopped"
  '';

  # ── VM deploy: KWin script ────────────────────────────────────────────────────

  vm-deploy-kwin-script = mkApp "aerogel-vm-deploy-kwin-script" (baseDeps ++ sshDeps) ''
    ${buildText}
    echo "aerogel: deploying KWin script to VM..."
    ${vmRun "mkdir -p ~/.local/share/kwin/scripts/aerogel/contents/code"}
    ${vmCopy "package/contents/code/main.js" "~/.local/share/kwin/scripts/aerogel/contents/code/main.js"}
    echo "aerogel: deploying icon to VM..."
    ${vmRun "mkdir -p ~/.local/share/icons/hicolor/scalable/apps"}
    ${vmCopy "assets/aerogel-logo.svg" "~/.local/share/icons/hicolor/scalable/apps/aerogel.svg"}
    echo "aerogel: restarting KWin..."
    ${vmRun "WAYLAND_DISPLAY=wayland-0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus kwin_wayland --replace &>/dev/null & sleep 2 && journalctl --user -b | grep '\\[aerogel\\]' | tail -5"}
  '';

  # ── VM deploy: widget ─────────────────────────────────────────────────────────

  vm-deploy-widget = mkApp "aerogel-vm-deploy-widget" (baseDeps ++ sshDeps) ''
    ${cdRepo}
    echo "aerogel: deploying widget to VM..."
    ${vmRun "mkdir -p ~/.local/share/plasma/plasmoids/org.aerogel.pager"}
    ${vmCopy "widget/package/." "~/.local/share/plasma/plasmoids/org.aerogel.pager/"}
    echo "aerogel: deploying icon to VM..."
    ${vmRun "mkdir -p ~/.local/share/icons/hicolor/scalable/apps"}
    ${vmCopy "assets/aerogel-logo.svg" "~/.local/share/icons/hicolor/scalable/apps/aerogel.svg"}
    echo "aerogel: restarting plasmashell..."
    ${vmRun "WAYLAND_DISPLAY=wayland-0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus kquitapp6 plasmashell 2>/dev/null; sleep 1; WAYLAND_DISPLAY=wayland-0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus kstart6 plasmashell &>/dev/null &"}
    echo "aerogel: widget deployed (plasmashell restarted)"
  '';

  # ── VM deploy: both ───────────────────────────────────────────────────────────

  vm-deploy = mkApp "aerogel-vm-deploy" (baseDeps ++ sshDeps) ''
    ${buildText}

    # ── KWin script ───────────────────────────────────────────────────────────
    # Deploy the full package dir (not just main.js) so metadata.json and
    # config/main.xml are always present.  ~/.local/share overrides the Nix
    # store path, giving us hot-reload without a VM rebuild.
    echo "aerogel: deploying KWin script to VM..."
    ${vmRun "mkdir -p ~/.local/share/kwin/scripts/aerogel"}
    ${vmCopy "package/." "~/.local/share/kwin/scripts/aerogel/"}

    # ── Widget ────────────────────────────────────────────────────────────────
    echo "aerogel: deploying widget to VM..."
    ${vmRun "mkdir -p ~/.local/share/plasma/plasmoids/org.aerogel.pager"}
    ${vmCopy "widget/package/." "~/.local/share/plasma/plasmoids/org.aerogel.pager/"}

    # ── Icon ──────────────────────────────────────────────────────────────────
    echo "aerogel: deploying icon to VM..."
    ${vmRun "mkdir -p ~/.local/share/icons/hicolor/scalable/apps"}
    ${vmCopy "assets/aerogel-logo.svg" "~/.local/share/icons/hicolor/scalable/apps/aerogel.svg"}

    # ── KWin config ───────────────────────────────────────────────────────────
    # Enable the aerogel KWin script.  plasma-manager writes this at NixOS
    # image build time but the VM disk is ephemeral -- write it explicitly on
    # every deploy so it survives fresh boots without a VM rebuild.
    echo "aerogel: enabling KWin script in kwinrc..."
    ${vmRun "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus kwriteconfig6 --file kwinrc --group Plugins --key aerogelEnabled true"}

    # ── Shortcut conflicts ────────────────────────────────────────────────────
    echo "aerogel: clearing shortcut conflicts..."
    ${vmRun "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus kwriteconfig6 --file kglobalshortcutsrc --group kwin --key view_zoom_out 'none,Meta+-,Zoom Out'"}
    ${vmRun "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus kwriteconfig6 --file kglobalshortcutsrc --group kwin --key view_zoom_in 'none,Meta++\tMeta+=,Zoom In'"}
    ${vmRun "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus kwriteconfig6 --file kglobalshortcutsrc --group kwin --key 'Walk Through Windows (Reverse)' 'Alt+Shift+Tab,Alt+Shift+Tab,Walk Through Windows (Reverse)'"}

    # ── Restart KWin ─────────────────────────────────────────────────────────
    echo "aerogel: restarting KWin..."
    ${vmRun "WAYLAND_DISPLAY=wayland-0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus kwin_wayland --replace &>/dev/null & sleep 3"}

    # ── Restart plasmashell ───────────────────────────────────────────────────
    # plasmashell reads plasma-org.kde.plasma.desktop-appletsrc on startup.
    # plasma-manager already wrote the panel layout (with org.aerogel.pager)
    # into that file at NixOS image build time, so a clean restart picks it up.
    echo "aerogel: restarting plasmashell..."
    ${vmRun "WAYLAND_DISPLAY=wayland-0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus kquitapp6 plasmashell 2>/dev/null; sleep 1; WAYLAND_DISPLAY=wayland-0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus kstart6 plasmashell &>/dev/null &"}
    ${vmRun "sleep 3"}

    echo "aerogel: checking KWin logs..."
    ${vmRun "journalctl --user -b | grep '\\[aerogel\\]' | tail -5"}
  '';

  # ── Host install: KWin script only ────────────────────────────────────────────

  kwin-script-install = mkApp "aerogel-kwin-script-install"
    (baseDeps ++ kptDeps ++ kconfDeps)
    ''
      ${buildText}
      ${enableShortcutOps}
      ${kpt} --type=KWin/Script --install=package || \
      ${kpt} --type=KWin/Script --upgrade=package
    '';

  kwin-script-reinstall = mkApp "aerogel-kwin-script-reinstall"
    (baseDeps ++ kptDeps)
    ''
      ${buildText}
      ${kpt} --type=KWin/Script --upgrade=package
    '';

  kwin-script-uninstall = mkApp "aerogel-kwin-script-uninstall"
    ([ pkgs.git ] ++ kptDeps ++ kconfDeps)
    ''
      ${cdRepo}
      ${kpt} --type=KWin/Script --remove=aerogel
      ${disableShortcutOps}
    '';

  # ── Host install: widget only ─────────────────────────────────────────────────

  widget-install = mkApp "aerogel-widget-install"
    ([ pkgs.git ] ++ kptDeps)
    ''
      ${cdRepo}
      ${kpt} --type=Plasma/Applet --install=widget/package || \
      ${kpt} --type=Plasma/Applet --upgrade=widget/package
    '';

  widget-reinstall = mkApp "aerogel-widget-reinstall"
    ([ pkgs.git ] ++ kptDeps)
    ''
      ${cdRepo}
      ${kpt} --type=Plasma/Applet --upgrade=widget/package
    '';

  widget-uninstall = mkApp "aerogel-widget-uninstall"
    ([ pkgs.git ] ++ kptDeps)
    ''
      ${cdRepo}
      ${kpt} --type=Plasma/Applet --remove=org.aerogel.pager
    '';

  # ── Host install: combined (KWin script + widget) ─────────────────────────────

  install = mkApp "aerogel-install"
    (baseDeps ++ kptDeps ++ kconfDeps)
    ''
      ${buildText}
      ${enableShortcutOps}
      ${kpt} --type=KWin/Script --install=package || \
      ${kpt} --type=KWin/Script --upgrade=package
      ${kpt} --type=Plasma/Applet --install=widget/package || \
      ${kpt} --type=Plasma/Applet --upgrade=widget/package
    '';

  reinstall = mkApp "aerogel-reinstall"
    (baseDeps ++ kptDeps)
    ''
      ${buildText}
      ${kpt} --type=KWin/Script --upgrade=package
      ${kpt} --type=Plasma/Applet --upgrade=widget/package
    '';

  uninstall = mkApp "aerogel-uninstall"
    ([ pkgs.git ] ++ kptDeps ++ kconfDeps)
    ''
      ${cdRepo}
      ${kpt} --type=KWin/Script --remove=aerogel
      ${kpt} --type=Plasma/Applet --remove=org.aerogel.pager
      ${disableShortcutOps}
    '';

  # ── Shortcut management (standalone) ─────────────────────────────────────────

  aerogel-enable = mkApp "aerogel-enable"
    ([ pkgs.kdePackages.kconfig pkgs.dbus ] ++ baseDeps)
    ''
      ${cdRepo}
      ${enableShortcutOps}
    '';

  aerogel-disable = mkApp "aerogel-disable"
    ([ pkgs.kdePackages.kconfig pkgs.dbus ] ++ baseDeps)
    ''
      ${cdRepo}
      ${disableShortcutOps}
    '';
}
