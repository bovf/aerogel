/*
 * NumberBox.qml -- Aerogel Pager
 *
 * A compact, rectangular workspace number indicator.
 * Uses Kirigami theme tokens and PlasmaComponents for full KDE theme compliance.
 *
 * Properties:
 *   label      -- text to display (workspace number or name)
 *   isActive   -- true when this box represents the current workspace
 *   hasWindows -- true when the workspace has at least one window (shows dot)
 */
import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

Rectangle {
    id: numberBox

    // ── Public API ────────────────────────────────────────────────────────────

    property string label: "1"
    property bool isActive: false
    property bool hasWindows: false

    // ── Kirigami colour set ───────────────────────────────────────────────────
    // Attach to the Button colour set -- this is what panel icons use.
    // Kirigami.Theme then resolves highlight/text/bg from the active Plasma
    // colour scheme, so the widget looks correct in Breeze, Breeze Dark,
    // custom themes, and high-contrast modes automatically.

    Kirigami.Theme.colorSet: Kirigami.Theme.Button
    Kirigami.Theme.inherit: false

    // ── Sizing ────────────────────────────────────────────────────────────────

    implicitWidth:  Math.max(labelText.implicitWidth + Kirigami.Units.smallSpacing * 3,
                             Kirigami.Units.gridUnit * 1.6)
    implicitHeight: Math.max(labelText.implicitHeight + Kirigami.Units.smallSpacing,
                             Kirigami.Units.gridUnit * 1.2)

    // ── Appearance ────────────────────────────────────────────────────────────

    radius: Kirigami.Units.cornerRadius

    // Active: highlight tint from the current colour scheme.
    // Inactive: fully transparent -- panel background shows through.
    color: isActive
        ? Qt.alpha(Kirigami.Theme.highlightColor, 0.20)
        : "transparent"

    border.width: 1
    border.color: isActive
        ? Kirigami.Theme.highlightColor
        : Qt.alpha(Kirigami.Theme.textColor, 0.20)

    // ── Label ─────────────────────────────────────────────────────────────────
    // PlasmaComponents.Label inherits the Plasma font and colour pipeline
    // (including colour-scheme overrides, accent colour, HiDPI scaling).

    PlasmaComponents.Label {
        id: labelText
        anchors.centerIn: parent

        text: numberBox.label

        // Active: highlight colour (matches border).
        // Inactive: standard text colour at reduced opacity.
        color: numberBox.isActive
            ? Kirigami.Theme.highlightColor
            : Qt.alpha(Kirigami.Theme.textColor, 0.75)

        font.bold: numberBox.isActive

        // Don't let the label overflow the box.
        elide: Text.ElideRight
    }

    // ── Window presence dot ───────────────────────────────────────────────────
    // Small accent-coloured pip when the workspace has windows (inactive only).

    Rectangle {
        visible: numberBox.hasWindows && !numberBox.isActive
        anchors {
            right:        parent.right
            bottom:       parent.bottom
            rightMargin:  3
            bottomMargin: 3
        }
        width:  4
        height: 4
        radius: 2
        color: Qt.alpha(Kirigami.Theme.textColor, 0.5)
    }
}
