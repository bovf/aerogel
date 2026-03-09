# nix/widget.nix
#
# Builds the Aerogel Pager plasmoid and installs it to the standard KDE
# XDG data path so Plasma's KPackage loader finds it via $XDG_DATA_DIRS:
#
#   $out/share/plasma/plasmoids/org.aerogel.pager/
#   ├── metadata.json
#   └── contents/
#       └── ui/
#           ├── main.qml
#           ├── NumberBox.qml
#           ├── CompactRep.qml
#           └── FullRep.qml
#
# Pure QML -- no compilation step needed.
# Add to home.packages so Plasma discovers it on next login.
#
{ pkgs }:

pkgs.stdenvNoCC.mkDerivation {
  pname = "plasma6-applets-aerogel-pager";
  version = "0.1.0";

  src = ../widget/package;

  dontBuild = true;
  dontWrapQtApps = true;

  installPhase = ''
    runHook preInstall
    install -d $out/share/plasma/plasmoids/org.aerogel.pager
    cp -r . $out/share/plasma/plasmoids/org.aerogel.pager/
    runHook postInstall
  '';

  meta = with pkgs.lib; {
    description = "Aerogel Pager -- workspace indicator and switcher for the Aerogel KWin tiling script";
    license = licenses.gpl3Plus;
    platforms = platforms.linux;
  };
}
