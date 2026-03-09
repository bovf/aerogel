{
  description = "Aerogel -- AeroSpace-inspired BSP tiling KWin script";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # Per-system output helpers (devShells, apps, packages).
    flake-utils.url = "github:numtide/flake-utils";

    # VM test: home-manager + plasma-manager to declaratively install the script.
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    plasma-manager = {
      url = "github:nix-community/plasma-manager";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.home-manager.follows = "home-manager";
    };
  };

  outputs = { self, nixpkgs, flake-utils, home-manager, plasma-manager }:
    let
      # ── nixosConfigurations lives outside eachSystem ─────────────────────────
      # It is always x86_64-linux -- a single concrete VM target.
      vmSystem = "x86_64-linux";
    in
    # ── Per-system outputs: devShells, packages, apps ──────────────────────────
    flake-utils.lib.eachSystem
      [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ]
      (system:
        let
          pkgs   = import ./nix/pkgs.nix { inherit nixpkgs system; };
          # vmBin is only meaningful on the VM target system; on others it's null.
          vmBin  = if system == vmSystem
                   then self.nixosConfigurations.vm.config.system.build.vm
                   else null;

          # ── Individual packages ──────────────────────────────────────────────
          # Names mirror AUR split-package names for 1:1 correspondence.
          kwinScriptPkg = import ./nix/package.nix { inherit pkgs; };
          widgetPkg     = import ./nix/widget.nix  { inherit pkgs; };
          cursorPkg     = import ./nix/cursor.nix  { inherit pkgs; };
          iconsPkg      = import ./nix/icons.nix   { inherit pkgs; };
        in
        {
          packages = {
            # KWin script -- installs to $out/share/kwin/scripts/aerogel/
            kwin-scripts-aerogel = kwinScriptPkg;

            # Plasma pager widget -- installs to $out/share/plasma/plasmoids/org.aerogel.pager/
            plasma6-applets-aerogel-pager = widgetPkg;

            # Cursor warp helper -- installs aerogel-cursor binary + D-Bus
            # activation file + systemd user unit.  Requires ydotool at runtime.
            aerogel-cursor = cursorPkg;

            # Aerogel icon -- installs to $out/share/icons/hicolor/scalable/apps/aerogel.svg
            aerogel-icons = iconsPkg;

            # Combined: all four packages merged into one output.
            # Uses cp (not symlinkJoin) because Plasma 6.6+ rejects packages
            # whose files are symlinks pointing outside $out -- it treats them
            # as path-traversal attacks.  Copying avoids that security check.
            default = pkgs.stdenvNoCC.mkDerivation {
              name = "aerogel";
              dontUnpack = true;
              dontBuild  = true;
              installPhase = ''
                runHook preInstall
                cp -r ${kwinScriptPkg}/. $out
                chmod -R u+w $out
                cp -r ${widgetPkg}/. $out
                chmod -R u+w $out
                cp -r ${cursorPkg}/. $out
                chmod -R u+w $out
                cp -r ${iconsPkg}/. $out
                runHook postInstall
              '';
            };
          };

          devShells.default = import ./nix/devshell.nix { inherit pkgs; };

          # All apps -- vm/vm-ssh/kill-vm are Linux-only inside apps.nix.
          apps = import ./nix/apps.nix { inherit pkgs vmBin; };
        })

    # ── System-level outputs (merged with // ) ─────────────────────────────────
    // {
      # Home-Manager module -- system-agnostic, lives outside eachSystem.
      # Usage:
      #   imports = [ inputs.aerogel.homeManagerModules.default ];
      #   aerogel.enable     = true;
      #   aerogel.cursorWarp = true;   # default: true
      homeManagerModules.default = import ./nix/hm-module.nix;

      # NixOS system-level module -- sets udev rule for /dev/uinput and
      # optionally adds users to the "input" group.
      # Not needed on Arch/CachyOS (ydotool package ships the rule itself).
      nixosModules.default = import ./nix/nixos-module.nix;

      # NixOS VM for manual testing.
      # Run with:  nix run .#vm
      nixosConfigurations.vm = nixpkgs.lib.nixosSystem {
        system = vmSystem;
        specialArgs = { inputs = { inherit self home-manager plasma-manager; }; };
        modules = [
          home-manager.nixosModules.home-manager
          { home-manager.sharedModules = [ plasma-manager.homeModules.plasma-manager ]; }
          (import ./nix/nixos-module.nix)
          ./nix/vm/default.nix
        ];
      };
    };
}
