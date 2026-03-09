# nix/devshell.nix
#
# Development shell for aerogel.
# Activated automatically via `direnv allow` (see .envrc).
# Also available as `nix develop`.
#
{ pkgs }:

pkgs.mkShell {
  name = "aerogel-dev";

  packages =
    [
      # JS / TS toolchain
      pkgs.nodejs
      pkgs.nodePackages.typescript

      # Build tooling
      pkgs.gnumake
    ]
    # KDE/Linux tooling -- only available/relevant on Linux.
    ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
      pkgs.kdePackages.kpackage  # kpackagetool6 -- KWin script + widget installer
      pkgs.kdePackages.qttools   # qdbus -- D-Bus introspection, used by window-dump
      pkgs.openssh               # ssh/scp for nix run .#vm-ssh
    ];

  shellHook = ''
    if [ ! -d node_modules ]; then
      echo "[aerogel] node_modules not found -- running npm install..."
      npm install
    fi

    echo ""
    echo "aerogel dev shell"
    echo "================="
    echo ""
    echo "  Build"
    echo "  -----"
    echo "  nix run .#build                    compile TypeScript → package/contents/code/main.js"
    echo "  nix run .#clean                    remove compiled output"
    echo ""
    ${pkgs.lib.optionalString pkgs.stdenv.isLinux ''
    echo "  Host install (KDE on this machine)"
    echo "  -----------------------------------"
    echo "  nix run .#install                  build + install KWin script + widget"
    echo "  nix run .#reinstall                build + upgrade KWin script + widget"
    echo "  nix run .#uninstall                remove KWin script + widget"
    echo ""
    echo "  nix run .#kwin-script-install      build + install KWin script only"
    echo "  nix run .#kwin-script-reinstall    build + upgrade KWin script only"
    echo "  nix run .#kwin-script-uninstall    remove KWin script only"
    echo ""
    echo "  nix run .#widget-install           install Plasma pager widget only"
    echo "  nix run .#widget-reinstall         upgrade Plasma pager widget only"
    echo "  nix run .#widget-uninstall         remove Plasma pager widget only"
    echo ""
    echo "  Test VM"
    echo "  -------"
    echo "  nix run .#vm                       launch ephemeral KDE Plasma 6 VM (SPICE display)"
    echo "  nix run .#vm-ssh                   SSH into the running VM"
    echo "  nix run .#kill-vm                  stop the VM"
    echo ""
    echo "  VM quick-deploy (build + push + restart)"
    echo "  ----------------------------------------"
    echo "  nix run .#vm-deploy                deploy KWin script + widget to VM"
    echo "  nix run .#vm-deploy-kwin-script    deploy KWin script only to VM"
    echo "  nix run .#vm-deploy-widget         deploy widget only to VM"
    echo ""
    echo "  VM logs"
    echo "  -------"
    echo "  nix run .#vm-ssh -- \"journalctl --user -b | grep '\[aerogel\]'\""
    echo ""
    echo "  Diagnostics"
    echo "  -----------"
    echo "  nix run .#window-dump              dump all current KWin windows (class, name, caption, flags)"
    echo "  nix run .#window-dump -- watch     continuously log new windows as they appear/disappear"
    echo ""
    ''}
  '';
}
