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
        root.refreshAerogelState()
    }

    // ── Aerogel enabled state ─────────────────────────────────────────────────
    // Tracked by polling isScriptLoaded on the KWin Scripting D-Bus interface.

    property bool aerogelEnabled: true

    function refreshAerogelState() {
        DBus.SessionBus.asyncCall({
            service:   "org.kde.KWin",
            path:      "/Scripting",
            iface:     "org.kde.kwin.Scripting",
            member:    "isScriptLoaded",
            arguments: [ new DBus.string("aerogel") ],
        }, function(result) {
            root.aerogelEnabled = (result === true || result === "true")
        })
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

    // Toggle the aerogel KWin script on/off.
    //
    // Disable: call unloadScript("aerogel") -- stops tiling immediately.
    //   kwinrc is NOT changed, so aerogelEnabled=true remains on disk.
    //
    // Enable: call reconfigure() -- KWin re-reads kwinrc (still true),
    //   restarts aerogel through its plugin system, which re-runs init()
    //   and tiles all currently-open windows via workspace.windowList().
    //
    // This avoids any need to write kwinrc from the plasmoid (no subprocess,
    // no D-Bus kconfig service needed).

    function toggleAerogel() {
        const enable = !root.aerogelEnabled
        // Optimistically update UI immediately.
        root.aerogelEnabled = enable

        if (enable) {
            // Re-enable: ask KWin to reload its config -- since kwinrc still
            // has aerogelEnabled=true, KWin will restart the plugin cleanly.
            DBus.SessionBus.asyncCall({
                service: "org.kde.KWin",
                path:    "/KWin",
                iface:   "org.kde.KWin",
                member:  "reconfigure",
            }, function() {
                // Verify actual state after KWin has settled (~2 s).
                refreshTimer.restart()
            })
        } else {
            // Disable: unload the running script immediately.
            DBus.SessionBus.asyncCall({
                service:   "org.kde.KWin",
                path:      "/Scripting",
                iface:     "org.kde.kwin.Scripting",
                member:    "unloadScript",
                arguments: [ new DBus.string("aerogel") ],
            }, function() {
                refreshTimer.restart()
            })
        }
    }

    // Delay re-querying isScriptLoaded to let KWin settle after reconfigure.
    Timer {
        id: refreshTimer
        interval: 2000
        repeat: false
        onTriggered: root.refreshAerogelState()
    }

    // Human-readable label for a desktop UUID.
    function labelForDesktopId(desktopId) {
        const ids   = pagerModel.desktopIds
        const names = pagerModel.desktopNames
        for (let i = 0; i < ids.length; i++) {
            if (ids[i] === desktopId) {
                const name = (names && names[i]) ? names[i] : ""
                return (name && name !== "Desktop " + (i + 1)) ? name : String(i + 1)
            }
        }
        return "?"
    }

    // ── Compact representation ────────────────────────────────────────────────
    // Note: we do NOT pass pagerModel as a property -- CompactRep owns its own
    // VirtualDesktopInfo instance so QML's binding engine can track it directly.

    compactRepresentation: CompactRep {
        switchDesktop: root.switchDesktop
        onOpenMenu:    root.openDropdown()
    }

    // Required by PlasmoidItem -- kept minimal since we never expand.
    fullRepresentation: Item { implicitWidth: 1; implicitHeight: 1 }

    // ── Dropdown menu ─────────────────────────────────────────────────────────

    property var menuRecentIds: []

    function openDropdown() {
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
        QQC2.MenuItem {
            implicitHeight: Math.max(implicitContentHeight,
                                     Kirigami.Units.gridUnit * 1.75)
            leftPadding:  Kirigami.Units.largeSpacing * 2
            rightPadding: Kirigami.Units.largeSpacing * 2

            text: root.aerogelEnabled
                ? i18nc("@action:inmenu", "Disable Aerogel Tiling")
                : i18nc("@action:inmenu", "Enable Aerogel Tiling")
            checkable: true
            checked:   root.aerogelEnabled
            onTriggered: root.toggleAerogel()
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
