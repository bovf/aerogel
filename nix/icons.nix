# nix/icons.nix
#
# Installs the Aerogel icon into the hicolor icon theme so KDE can resolve
# "Icon": "aerogel" in metadata.json via QIcon::fromTheme().
#
#   $out/share/icons/hicolor/scalable/apps/aerogel.svg
#
# KDE Store users can install this package separately to get the custom
# icon in the "Add Widgets" panel and KWin Scripts system settings list.
#
# Add to home.packages -- home-manager puts $out on $XDG_DATA_DIRS so
# Qt's icon theme loader finds it.
#
{ pkgs }:

pkgs.stdenvNoCC.mkDerivation {
  pname = "aerogel-icons";
  version = "0.1.0";

  src = ../assets/aerogel-logo.svg;

  dontUnpack = true;
  dontBuild  = true;

  installPhase = ''
    runHook preInstall
    install -Dm644 $src $out/share/icons/hicolor/scalable/apps/aerogel.svg
    runHook postInstall
  '';

  meta = with pkgs.lib; {
    description = "Aerogel icon for KDE integration (hicolor icon theme)";
    license     = licenses.gpl3Plus;
    platforms   = platforms.all;
  };
}
