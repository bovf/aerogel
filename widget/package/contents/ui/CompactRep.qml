/*
 * CompactRep.qml -- Aerogel Pager
 *
 * The panel (compact) representation.
 * Shows a single NumberBox with the current workspace number.
 *
 * Left-click  → emits openMenu signal (main.qml opens the dropdown).
 * Mouse wheel → cycles workspaces directly.
 */
import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami
import org.kde.taskmanager

Item {
    id: compactRoot

    required property var switchDesktop
    signal openMenu()

    // ── Own desktop model ─────────────────────────────────────────────────────
    // We create VirtualDesktopInfo here rather than receiving it as a var
    // property -- this ensures QML's binding engine can track property
    // changes on the object directly and update currentIndex reactively.

    VirtualDesktopInfo {
        id: desktopInfo
    }

    // ── Sizing ────────────────────────────────────────────────────────────────

    implicitWidth:  box.implicitWidth  + Kirigami.Units.smallSpacing * 2
    implicitHeight: box.implicitHeight + Kirigami.Units.smallSpacing

    Layout.minimumWidth:  implicitWidth
    Layout.minimumHeight: implicitHeight
    Layout.preferredWidth:  implicitWidth
    Layout.preferredHeight: implicitHeight

    // ── Current desktop label (1-based) ──────────────────────────────────────
    // Directly bound to desktopInfo properties -- updates automatically when
    // the user switches workspace.

    readonly property int currentIndex: {
        const ids = desktopInfo.desktopIds
        const cur = desktopInfo.currentDesktop
        for (let i = 0; i < ids.length; i++) {
            if (ids[i] === cur) return i + 1
        }
        return 1
    }

    // ── NumberBox ─────────────────────────────────────────────────────────────

    NumberBox {
        id: box
        anchors.centerIn: parent
        label:      compactRoot.currentIndex.toString()
        isActive:   true
        hasWindows: false
    }

    // ── Mouse interactions ────────────────────────────────────────────────────

    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton

        onClicked: compactRoot.openMenu()

        onWheel: wheel => {
            const delta = wheel.angleDelta.y !== 0
                ? wheel.angleDelta.y
                : -wheel.angleDelta.x
            if (delta > 0)      compactRoot.switchDesktop(-1)  // previous
            else if (delta < 0) compactRoot.switchDesktop(1)   // next
        }
    }
}
