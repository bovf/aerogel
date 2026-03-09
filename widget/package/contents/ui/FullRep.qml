/*
 * FullRep.qml -- Aerogel Pager
 *
 * The full (popup) representation, shown when the compact panel item is clicked.
 * Displays a grid of NumberBox items -- one per virtual desktop -- using the same
 * visual language as the compact view but with all workspaces visible at once.
 *
 * Clicking a box switches to that workspace and collapses the popup.
 */
import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents
import org.kde.kirigami as Kirigami

Item {
    id: fullRoot

    // Provided by main.qml.
    required property var pagerModel
    required property var setCurrentDesktop      // function(oneBasedIndex)
    required property var windowCountForDesktop  // function(desktopId) -> int

    // ── Grid layout ───────────────────────────────────────────────────────────
    // Up to 5 columns; wrap to next row after that.

    readonly property int maxColumns: 5
    readonly property int desktopCount: pagerModel.numberOfDesktops
    readonly property int columns: Math.min(desktopCount, maxColumns)

    // Preferred popup size: just large enough to hold the grid.
    readonly property int boxSize: Kirigami.Units.gridUnit * 2
    readonly property int spacing: Kirigami.Units.smallSpacing

    Layout.minimumWidth:  columns * boxSize + (columns - 1) * spacing + Kirigami.Units.largeSpacing * 2
    Layout.minimumHeight: Math.ceil(desktopCount / columns) * boxSize
                        + (Math.ceil(desktopCount / columns) - 1) * spacing
                        + Kirigami.Units.largeSpacing * 2

    Layout.preferredWidth:  Layout.minimumWidth
    Layout.preferredHeight: Layout.minimumHeight

    // ── Grid ──────────────────────────────────────────────────────────────────

    Grid {
        id: grid
        anchors.centerIn: parent
        columns: fullRoot.columns
        spacing: fullRoot.spacing

        Repeater {
            model: fullRoot.pagerModel.numberOfDesktops

            delegate: NumberBox {
                id: desktopBox

                readonly property string desktopId:  fullRoot.pagerModel.desktopIds[index]
                readonly property bool   isCurrent:  fullRoot.pagerModel.currentDesktop === desktopId

                width:  fullRoot.boxSize
                height: fullRoot.boxSize

                label:     (index + 1).toString()
                isActive:  isCurrent
                hasWindows: fullRoot.windowCountForDesktop(desktopId) > 0

                // ── Click to switch ───────────────────────────────────────────

                MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor

                    onClicked: {
                        fullRoot.setCurrentDesktop(index + 1)
                        Plasmoid.expanded = false
                    }
                }
            }
        }
    }
}
