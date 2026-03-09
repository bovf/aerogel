# nix/package.nix
#
# Builds the aerogel KWin script and installs it to the standard KDE
# XDG data path so KWin's KPackage loader finds it via $XDG_DATA_DIRS:
#
#   $out/share/kwin/scripts/aerogel/
#   ├── metadata.json
#   └── contents/
#       ├── code/
#       │   └── main.js        ← compiled from src/ by tsc
#       └── config/
#           └── main.xml
#
# Add to home.packages -- home-manager puts $out on $XDG_DATA_DIRS so
# KWin's KPackage finds the script at startup.
# Then set kwinrc.Plugins.aerogelEnabled = true to activate it.
#
{ pkgs }:

pkgs.buildNpmPackage {
  pname = "kwin-scripts-aerogel";
  version = "0.1.0";

  src = pkgs.lib.cleanSource ../.;

  npmDepsHash = "sha256-xdWpdcnF0qNBrEU+rxnOHi/JFw0B0B0tGxKnGq46ID0=";

  # Only the compiler is needed -- no runtime node_modules in the output.
  npmBuildScript = "build";

  installPhase = ''
    runHook preInstall
    install -d $out/share/kwin/scripts/aerogel
    cp -r package/. $out/share/kwin/scripts/aerogel/
    runHook postInstall
  '';

  meta = with pkgs.lib; {
    description = "Aerogel BSP tiling KWin script for KDE Plasma 6";
    license     = licenses.gpl3Plus;
    platforms   = platforms.linux;
  };
}
