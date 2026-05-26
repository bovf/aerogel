/*
 * main.qml -- Aerogel Pager
 *
 * A compact workspace indicator for the KDE Plasma panel.
 *
 * Panel display:
 *   Single NumberBox showing the current workspace number (e.g. "3").
 *   Mouse wheel cycles workspaces without opening anything.
 *
 * Left-click:
 *   Opens a dropdown menu containing:
 *     • 10 most recently visited workspaces (click to switch)
 *     • ─────────────────────────────────────
 *     • Enable / Disable Aerogel Tiling toggle
 *     • ─────────────────────────────────────
 *     • Configure Virtual Desktops…
 *
 * Right-click:
 *   Reserved for standard Plasma widget management (KDE default behaviour).
 */
import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import QtQuick.Templates as T
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.workspace.dbus as DBus
import org.kde.plasma.plasma5support as P5Support
import org.kde.kirigami as Kirigami
import org.kde.taskmanager
import org.kde.kcmutils as KCM
import org.kde.config as KConfig

PlasmoidItem {
    id: root

    // ── Desktop model ─────────────────────────────────────────────────────────
    // Used by main.qml for recent-workspace tracking and the dropdown menu.
    // CompactRep creates its own instance so its binding is locally tracked.

    VirtualDesktopInfo {
        id: pagerModel
    }

    // ── Stay compact -- never expand to a fullRepresentation ──────────────────
    preferredRepresentation: compactRepresentation

    // ── Recent workspaces tracking ────────────────────────────────────────────
    property var recentDesktopIds: []
    readonly property int maxRecent: 10

    function recordVisit(desktopId) {
        let updated = recentDesktopIds.filter(id => id !== desktopId)
        updated.unshift(desktopId)
        if (updated.length > maxRecent) updated = updated.slice(0, maxRecent)
        recentDesktopIds = updated
    }

    Connections {
        target: pagerModel
        function onCurrentDesktopChanged() {
            root.recordVisit(pagerModel.currentDesktop)
        }
    }

    Component.onCompleted: {
        if (pagerModel.currentDesktop) root.recordVisit(pagerModel.currentDesktop)
        console.log("[aerogel-pager] started, polling state file every",
                    helperState.interval, "ms")
    }

    // ── Aerogel enabled state ─────────────────────────────────────────────────
    // Tracked by polling isScriptLoaded on the KWin Scripting D-Bus interface.
    //
    // Two reasons to keep this fresh independently of user interaction:
    //   1. Multi-monitor panels each have their own widget instance; toggling
    //      from one needs the other to reflect truth before the user clicks.
    //   2. refreshAerogelState() is async -- if the popup waits on it,
    //      the dropdown renders with the stale value and the menu item label
    //      ("Disable" vs "Enable") fires the wrong action on click.

    property bool aerogelEnabled: true

    // State source: cat $XDG_STATE_HOME/aerogel/enabled (helper writes
    // "true" / "false" on every Enable / Disable / startup).  We use
    // Plasma5Support.DataSource because Plasma 6's QML DBus binding does
    // not reliably deliver async replies from KWin's isScriptLoaded --
    // Timer fires every 500 ms but the callback never runs.  Reading a
    // ~5-byte file via cat is far cheaper than a D-Bus round-trip and
    // can't get stuck in the QML event loop.
    P5Support.DataSource {
        id: helperState
        engine: "executable"
        interval: 500
        property string sourceCmd:
            "cat \"${XDG_STATE_HOME:-$HOME/.local/state}/aerogel/enabled\" 2>/dev/null"

        Component.onCompleted: helperState.connectSource(sourceCmd)

        onNewData: function(sourceName, data) {
            try {
                if (sourceName !== sourceCmd) return
                const stdout = (data["stdout"] || "").trim()
                const next = (stdout === "true")
                if (next !== root.aerogelEnabled) {
                    console.log("[aerogel-pager] state:",
                                root.aerogelEnabled, "->", next,
                                "(stdout=", JSON.stringify(stdout), ")")
                    root.aerogelEnabled = next
                }
            } catch (e) {
                console.log("[aerogel-pager] onNewData error:", e)
            }
        }
    }

    function refreshAerogelState() {
        // No-op stub kept so existing call sites (Component.onCompleted,
        // openDropdown) still compile.  Real updates flow via helperState
        // above.
    }

    // Polling is now handled by the helperState Plasma5Support.DataSource
    // above (cat the helper's state file every 500 ms).  This Timer is
    // kept as a no-op for compatibility with refreshTimer call sites
    // elsewhere in the file; it doesn't actually do anything useful.
    Timer {
        id: aerogelStatePoll
        interval: 5000
        repeat:   false
        running:  false
    }

    // ── D-Bus helpers ─────────────────────────────────────────────────────────

    // Switch to a virtual desktop by 1-based index.
    // The aerogel KWin script subscribes to workspace.currentDesktopChanged
    // and reconciles its model when this fires externally.
    function setCurrentDesktop(oneBasedIndex) {
        DBus.SessionBus.asyncCall({
            service:   "org.kde.KWin",
            path:      "/KWin",
            iface:     "org.kde.KWin",
            member:    "setCurrentDesktop",
            arguments: [ new DBus.int32(oneBasedIndex) ],
        })
    }

    function setCurrentDesktopById(desktopId) {
        const ids = pagerModel.desktopIds
        for (let i = 0; i < ids.length; i++) {
            if (ids[i] === desktopId) { setCurrentDesktop(i + 1); return }
        }
    }

    // direction: +1 = next, -1 = previous
    function switchDesktop(direction) {
        const ids   = pagerModel.desktopIds
        const count = ids.length
        if (count < 2) return
        let current = 0
        for (let i = 0; i < ids.length; i++) {
            if (ids[i] === pagerModel.currentDesktop) { current = i; break }
        }
        setCurrentDesktop(((current + direction) % count + count) % count + 1)
    }

    // Set aerogel to a specific target state via the aerogel-helper service.
    //
    // We call explicit Enable() / Disable() -- NOT Toggle() -- because the
    // menu captured the user's intent at open time (dropdownMenu.snapshotEnabled).
    // Toggle() dispatches on the SERVER's current state, which can flip
    // mid-menu and produce the opposite of what the user clicked.  Calling
    // Enable/Disable explicitly always honours the label the user saw:
    // clicking "Disable" disables, even if aerogel happens to already be off
    // (helper is then a no-op).

    function setAerogelEnabled(target) {
        const member = target ? "Enable" : "Disable"
        root.aerogelEnabled = target

        DBus.SessionBus.asyncCall({
            service:   "org.aerogel.Helper",
            path:      "/org/aerogel/Helper",
            iface:     "org.aerogel.Helper",
            member:    member,
        }, function() {
            refreshTimer.restart()
        })
    }

    // Delay re-querying isScriptLoaded to let KWin settle after reconfigure.
    Timer {
        id: refreshTimer
        interval: 2000
        repeat: false
        onTriggered: root.refreshAerogelState()
    }

    // Label for a desktop UUID -- always the 1-based position in
    // pagerModel.desktopIds.  We deliberately ignore desktopNames: aerogel
    // mints virtual desktops dynamically, and KWin auto-generates names like
    // "Desktop 2" / "Desktop 5" that don't track the desktop's position in
    // the ordered list (which was causing workspace 1 to display as "2").
    // Position is what the pager is for; the numeric label always matches
    // the CompactRep number on the panel.
    function labelForDesktopId(desktopId) {
        const ids = pagerModel.desktopIds
        for (let i = 0; i < ids.length; i++) {
            if (ids[i] === desktopId) return String(i + 1)
        }
        return "?"
    }

    // ── Compact representation ────────────────────────────────────────────────
    // Note: we do NOT pass pagerModel as a property -- CompactRep owns its own
    // VirtualDesktopInfo instance so QML's binding engine can track it directly.

    compactRepresentation: CompactRep {
        aerogelEnabled: root.aerogelEnabled
        switchDesktop:  root.switchDesktop
        onOpenMenu:     root.openDropdown()
    }

    // Required by PlasmoidItem -- kept minimal since we never expand.
    fullRepresentation: Item { implicitWidth: 1; implicitHeight: 1 }

    // ── Dropdown menu ─────────────────────────────────────────────────────────

    property var menuRecentIds: []

    function openDropdown() {
        // Pop the menu synchronously so the click event isn't lost.
        // Kick off a fresh state poll in parallel; it lands within ~50 ms
        // and updates root.aerogelEnabled via QML bindings before the user
        // can click anything.  The menu also captures the state in
        // dropdownMenu.snapshotEnabled at aboutToShow so the label and the
        // click action stay consistent even if the poll fires mid-menu.
        root.refreshAerogelState()
        const allIds = pagerModel.desktopIds
        root.menuRecentIds = root.recentDesktopIds.filter(
            id => allIds.indexOf(id) !== -1
        )
        dropdownMenu.popup()
    }

    QQC2.Menu {
        id: dropdownMenu

        // Open as a real top-level window so the panel doesn't clip its height.
        popupType: T.Popup.Window

        // Snapshot the enabled state at menu-open time and use it for BOTH
        // the toggle item's label and its action.  Without this snapshot, a
        // mid-menu poll tick could flip root.aerogelEnabled between the
        // label render and the click handler -- producing "Disable" text
        // that calls Enable, or vice versa.
        property bool snapshotEnabled: false
        onAboutToShow: snapshotEnabled = root.aerogelEnabled

        // ── Minimum width ─────────────────────────────────────────────────────
        // QQC2.Menu sizes to its widest item by default; override so the menu
        // is always at least ~220 px wide regardless of item text length.
        // Kirigami.Units.gridUnit is typically 18 px, so * 14 ≈ 252 px.
        implicitWidth: Math.max(contentItem.implicitWidth,
                                Kirigami.Units.gridUnit * 14)

        // ── Recent workspaces ─────────────────────────────────────────────────
        Repeater {
            model: root.menuRecentIds

            QQC2.MenuItem {
                required property string modelData
                required property int    index

                readonly property bool isCurrent: modelData === pagerModel.currentDesktop

                // Give each item a generous minimum height and horizontal padding
                // so it feels like a real native menu item.
                implicitHeight: Math.max(implicitContentHeight,
                                         Kirigami.Units.gridUnit * 1.75)
                leftPadding:  Kirigami.Units.largeSpacing * 2
                rightPadding: Kirigami.Units.largeSpacing * 2

                text: {
                    const lbl = root.labelForDesktopId(modelData)
                    return isCurrent ? "● " + lbl : lbl
                }
                enabled: !isCurrent
                onTriggered: {
                    root.setCurrentDesktopById(modelData)
                    dropdownMenu.close()
                }
            }
        }

        QQC2.MenuSeparator {}

        // ── Aerogel toggle ────────────────────────────────────────────────────
        // Both text and action read from dropdownMenu.snapshotEnabled, which
        // is captured at onAboutToShow.  Guarantees the click does what the
        // label says even if root.aerogelEnabled updates while the menu is
        // open.
        QQC2.MenuItem {
            implicitHeight: Math.max(implicitContentHeight,
                                     Kirigami.Units.gridUnit * 1.75)
            leftPadding:  Kirigami.Units.largeSpacing * 2
            rightPadding: Kirigami.Units.largeSpacing * 2

            text: dropdownMenu.snapshotEnabled
                ? i18nc("@action:inmenu", "Disable Aerogel Tiling")
                : i18nc("@action:inmenu", "Enable Aerogel Tiling")
            onTriggered: root.setAerogelEnabled(!dropdownMenu.snapshotEnabled)
        }

        // ── Configure virtual desktops ────────────────────────────────────────
        QQC2.MenuSeparator {
            visible: KConfig.KAuthorized.authorize("kcm_kwin_virtualdesktops")
        }

        QQC2.MenuItem {
            visible: KConfig.KAuthorized.authorize("kcm_kwin_virtualdesktops")

            implicitHeight: Math.max(implicitContentHeight,
                                     Kirigami.Units.gridUnit * 1.75)
            leftPadding:  Kirigami.Units.largeSpacing * 2
            rightPadding: Kirigami.Units.largeSpacing * 2

            text: i18nc("@action:inmenu", "Configure Virtual Desktops…")
            onTriggered: KCM.KCMLauncher.openSystemSettings("kcm_kwin_virtualdesktops")
        }
    }
}
