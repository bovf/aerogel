# nix/vm/default.nix
#
# Minimal NixOS configuration for the aerogel test VM.
# Run with:  nix run .#vm
#
# Boots into KDE Plasma 6, auto-logs in as the "aerogel" user, and activates
# the aerogel KWin script so you can test it immediately.
#
# The VM is ephemeral -- no state persists between runs.
#
{ inputs, pkgs, ... }:

{
  # ── Boot ────────────────────────────────────────────────────────────────────
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  # ── Filesystems ─────────────────────────────────────────────────────────────
  # Required by NixOS eval even for a QEMU VM; the actual virtual disk is
  # managed by virtualisation.vmVariant.
  fileSystems."/" = {
    device = "/dev/disk/by-label/nixos";
    fsType = "ext4";
  };

  # ── Basics ──────────────────────────────────────────────────────────────────
  networking.hostName = "aerogel-test";
  time.timeZone = "Europe/Sofia";
  i18n.defaultLocale = "en_US.UTF-8";

  # ── KDE Plasma 6 ────────────────────────────────────────────────────────────
  services.desktopManager.plasma6.enable = true;

  services.displayManager.sddm = {
    enable = true;
    wayland.enable = true;
  };

  # Auto-login: skip the SDDM prompt and land directly on the desktop.
  services.displayManager.autoLogin = {
    enable = true;
    user = "aerogel";
  };

  # ── Audio (KDE session expects PipeWire) ────────────────────────────────────
  services.pipewire = {
    enable = true;
    alsa.enable = true;
    pulse.enable = true;
  };

  # ── Clipboard sharing (host ↔ guest) ────────────────────────────────────────
  # spice-vdagentd runs inside the guest and talks to the SPICE channel that
  # remote-viewer (on the host) exposes.  Together they bridge the clipboard.
  services.spice-vdagentd.enable = true;

  # ── SSH ─────────────────────────────────────────────────────────────────────
  # Port 2222 on the host is forwarded to :22 in the guest (via QEMU_NET_OPTS
  # in flake.nix).  The private key lives at nix/vm/ssh_host_key (gitignored).
  # Connect with:  nix run .#vm-ssh
  services.openssh = {
    enable = true;
    settings.PasswordAuthentication = false;
  };

  # ── Aerogel system-level support (udev + input group) ───────────────────────
  # The nixosModules.default module sets the udev rule for /dev/uinput and
  # adds listed users to the "input" group -- both required for ydotoold.
  aerogel.enable = true;
  aerogel.users  = [ "aerogel" ];

  # ── Test user ───────────────────────────────────────────────────────────────
  users.users.aerogel = {
    isNormalUser = true;
    extraGroups = [ "wheel" "audio" "video" ];
    password = "aerogel";
    # Public key from nix/vm/ssh_host_key.pub (private key is gitignored).
    openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICGLmlydBUs3c/0ZqrBizf6jrX7WDjT+cHWe4nhrUWqe aerogel-vm-dev"
    ];
  };

  # ── Home Manager ────────────────────────────────────────────────────────────
  home-manager = {
    useGlobalPkgs = true;
    useUserPackages = true;
    # Pass the aerogel HM module through specialArgs so home.nix can import
    # it without a relative path that escapes the vm/ directory.
    extraSpecialArgs = {
      inherit inputs;
      aerogelModule = inputs.self.homeManagerModules.default;
    };
    users.aerogel = import ./home.nix;
  };

  # ── VM-specific tweaks ──────────────────────────────────────────────────────
  virtualisation.vmVariant = {
    virtualisation = {
      memorySize = 8192;   # MB -- plenty of RAM for KDE + dual QXL heads
      cores = 4;
      # Ephemeral: discard disk state on every boot.
      diskSize = 8192;     # MB

      # Dual-monitor via two separate QXL devices + SPICE.
      # remote-viewer automatically opens one window per QXL/SPICE display
      # channel -- drag the second window to your other physical monitor.
      #
      # Memory sizing for Linux KMS driver (two 1920×1080 heads):
      #   vgamem_mb=64  -- primary surface bar (must fit both displays)
      #   ram_size_mb=128  -- dynamic memory (cursors, commands, images)
      #   vram_size_mb=128 -- KMS surface allocation bar
      qemu.options = [
        "-vga none"
        # max_outputs=1 limits each QXL card to exactly one DRM connector.
        # Without this the qxl KMS driver exposes two connectors per card
        # (Virtual-1 + Virtual-2, Virtual-5 + Virtual-6), giving KWin four
        # screens instead of two and stretching tiled windows across the
        # combined ~4000 px-wide virtual desktop.
        "-device qxl-vga,id=video0,vgamem_mb=64,ram_size_mb=128,vram_size_mb=128,max_outputs=1"
        "-device qxl,id=video1,vgamem_mb=64,ram_size_mb=128,vram_size_mb=128,max_outputs=1"
        # virtio-serial + spice agent channel -- required for:
        #   - absolute mouse mode (no pointer grab / no Shift+F12)
        #   - clipboard sharing between host and guest
        #   - spice-vdagentd to function at all
        "-device virtio-serial-pci"
        "-chardev spicevmc,id=vdagent,name=vdagent"
        "-device virtserialport,chardev=vdagent,name=com.redhat.spice.0"
      ];
    };
  };

  system.stateVersion = "25.11";
}
