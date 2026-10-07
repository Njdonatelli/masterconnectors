// ERDiagramCanvas.swift
// Gridex
//
// Custom NSView that renders ER diagram tables and relationships
// using CoreGraphics for high-performance drawing.

import AppKit

final class ERDiagramCanvas: NSView {

    // MARK: - Constants

    static let cardWidth: CGFloat = 220
    static let headerHeight: CGFloat = 32
    static let rowHeight: CGFloat = 22
    static let cornerRadius: CGFloat = 8

    static func cardHeight(for table: ERTable) -> CGFloat {
        headerHeight + CGFloat(table.columns.count) * rowHeight + 4  // 4pt bottom padding
    }

    // MARK: - State

    private unowned var viewModel: ERDiagramViewModel
    private var dragTableId: String?
    private var dragOffset: CGPoint = .zero
    private var hoveredTableId: String?
    private var isPanning = false
    private var panOrigin: NSPoint = .zero
    private var isSpaceDown = false

    // MARK: - Colors (adaptive)

    private var cardBackground: NSColor { .controlBackgroundColor }
    private var cardBorder: NSColor { .separatorColor }
    private var headerBackground: NSColor { NSColor.controlAccentColor.withAlphaComponent(0.12) }
    private var headerText: NSColor { .labelColor }
    private var columnText: NSColor { .labelColor }
    private var typeText: NSColor { .secondaryLabelColor }
    private var pkBadge: NSColor { NSColor.systemYellow.withAlphaComponent(0.85) }
    private var fkBadge: NSColor { NSColor.systemBlue.withAlphaComponent(0.7) }
    private var relationshipLine: NSColor { NSColor.systemBlue.withAlphaComponent(0.5) }
    private var canvasBackground: NSColor { NSColor(calibratedWhite: 0.13, alpha: 1.0) }
    private var canvasBackgroundLight: NSColor { NSColor(calibratedWhite: 0.95, alpha: 1.0) }
    private var gridColor: NSColor { NSColor.separatorColor.withAlphaComponent(0.15) }

    // MARK: - Init

    init(viewModel: ERDiagramViewModel) {
        self.viewModel = viewModel
        super.init(frame: NSRect(x: 0, y: 0, width: 4000, height: 4000))
        wantsLayer = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    // MARK: - Drawing

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }

        // Resize canvas to fit all tables + padding.
        // Use the visible area (accounting for magnification) as a minimum
        // so the background always fills the viewport even when zoomed out.
        let tableBounds = viewModel.tableBounds()
        let scrollView = enclosingScrollView
        let visibleW = (scrollView?.contentView.bounds.width ?? 2000) / max(scrollView?.magnification ?? 1, 0.1)
        let visibleH = (scrollView?.contentView.bounds.height ?? 2000) / max(scrollView?.magnification ?? 1, 0.1)
        let needed = NSSize(
            width: max(visibleW + 200, tableBounds.maxX + 400),
            height: max(visibleH + 200, tableBounds.maxY + 400)
        )
        if abs(frame.size.width - needed.width) > 10 || abs(frame.size.height - needed.height) > 10 {
            setFrameSize(needed)
        }

        // Background
        let isDark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let bg = isDark ? canvasBackground : canvasBackgroundLight
        ctx.setFillColor(bg.cgColor)
        ctx.fill(dirtyRect)

        // Draw grid dots
        drawGrid(ctx: ctx, rect: dirtyRect, isDark: isDark)

        // Draw relationships first (under cards)
        for rel in viewModel.relationships {
            drawRelationship(ctx: ctx, rel: rel, isDark: isDark)
        }

        // Draw table cards
        for table in viewModel.tables {
            drawTableCard(ctx: ctx, table: table, isDark: isDark)
        }
    }

    // MARK: - Grid

    private func drawGrid(ctx: CGContext, rect: NSRect, isDark: Bool) {
        let spacing: CGFloat = 30
        let dotSize: CGFloat = 1.2
        ctx.setFillColor(gridColor.cgColor)

        let startX = floor(rect.minX / spacing) * spacing
        let startY = floor(rect.minY / spacing) * spacing
        var x = startX
        while x < rect.maxX {
            var y = startY
            while y < rect.maxY {
                ctx.fillEllipse(in: CGRect(x: x - dotSize / 2, y: y - dotSize / 2, width: dotSize, height: dotSize))
                y += spacing
            }
            x += spacing
        }
    }

    // MARK: - Table Card

    private func drawTableCard(ctx: CGContext, table: ERTable, isDark: Bool) {
        let cardW = Self.cardWidth
        let cardH = Self.cardHeight(for: table)
        let rect = CGRect(origin: table.position, size: CGSize(width: cardW, height: cardH))
        let isSelected = viewModel.selectedTableId == table.id
        let isHovered = hoveredTableId == table.id

        // Shadow
        ctx.saveGState()
        let shadowColor = NSColor.black.withAlphaComponent(isDark ? 0.5 : 0.15)
        ctx.setShadow(offset: CGSize(width: 0, height: 2), blur: isSelected ? 12 : 6, color: shadowColor.cgColor)

        // Card body
        let cardPath = CGPath(roundedRect: rect, cornerWidth: Self.cornerRadius, cornerHeight: Self.cornerRadius, transform: nil)
        let bgColor = isDark
            ? NSColor(calibratedWhite: 0.18, alpha: 1.0)
            : NSColor(calibratedWhite: 1.0, alpha: 1.0)
        ctx.setFillColor(bgColor.cgColor)
        ctx.addPath(cardPath)
        ctx.fillPath()
        ctx.restoreGState()

        // Border
        let borderColor: NSColor = isSelected
            ? .controlAccentColor
            : (isHovered ? .controlAccentColor.withAlphaComponent(0.5) : cardBorder)
        ctx.setStrokeColor(borderColor.cgColor)
        ctx.setLineWidth(isSelected ? 2.0 : 1.0)
        ctx.addPath(cardPath)
        ctx.strokePath()

        // Header background
        let headerRect = CGRect(x: rect.minX, y: rect.minY, width: cardW, height: Self.headerHeight)
        let headerPath = CGMutablePath()
        headerPath.move(to: CGPoint(x: rect.minX + Self.cornerRadius, y: rect.minY))
        headerPath.addLine(to: CGPoint(x: rect.maxX - Self.cornerRadius, y: rect.minY))
        headerPath.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + Self.cornerRadius),
                                control: CGPoint(x: rect.maxX, y: rect.minY))
        headerPath.addLine(to: CGPoint(x: rect.maxX, y: headerRect.maxY))
        headerPath.addLine(to: CGPoint(x: rect.minX, y: headerRect.maxY))
        headerPath.addLine(to: CGPoint(x: rect.minX, y: rect.minY + Self.cornerRadius))
        headerPath.addQuadCurve(to: CGPoint(x: rect.minX + Self.cornerRadius, y: rect.minY),
                                control: CGPoint(x: rect.minX, y: rect.minY))
        headerPath.closeSubpath()

        let accentColor = isSelected ? NSColor.controlAccentColor.withAlphaComponent(0.2) : headerBackground
        ctx.setFillColor(accentColor.cgColor)
        ctx.addPath(headerPath)
        ctx.fillPath()

        // Header separator
        ctx.setStrokeColor(cardBorder.cgColor)
        ctx.setLineWidth(0.5)
        ctx.move(to: CGPoint(x: rect.minX, y: headerRect.maxY))
        ctx.addLine(to: CGPoint(x: rect.maxX, y: headerRect.maxY))
        ctx.strokePath()

        // Table name
        let nameStr = NSAttributedString(string: table.name, attributes: [
            .font: NSFont.systemFont(ofSize: 12, weight: .semibold),
            .foregroundColor: headerText
        ])
        nameStr.draw(at: CGPoint(x: rect.minX + 10, y: rect.minY + 8))

        // Column count badge
        let countStr = NSAttributedString(string: "\(table.columns.count)", attributes: [
            .font: NSFont.systemFont(ofSize: 9, weight: .medium),
            .foregroundColor: NSColor.secondaryLabelColor
        ])
        let countSize = countStr.size()
        let badgeRect = CGRect(x: rect.maxX - countSize.width - 16, y: rect.minY + 9,
                               width: countSize.width + 8, height: 14)
        let badgePath = CGPath(roundedRect: badgeRect, cornerWidth: 4, cornerHeight: 4, transform: nil)
        ctx.setFillColor(NSColor.secondaryLabelColor.withAlphaComponent(0.1).cgColor)
        ctx.addPath(badgePath)
        ctx.fillPath()
        countStr.draw(at: CGPoint(x: badgeRect.minX + 4, y: badgeRect.minY + 1))

        // Columns
        var y = rect.minY + Self.headerHeight + 2
        for col in table.columns {
            drawColumnRow(ctx: ctx, col: col, x: rect.minX, y: y, width: cardW, isDark: isDark)
            y += Self.rowHeight
        }
    }

    private func drawColumnRow(ctx: CGContext, col: ERColumn, x: CGFloat, y: CGFloat, width: CGFloat, isDark: Bool) {
        let leftPad: CGFloat = 10
        let iconWidth: CGFloat = 18

        // PK/FK icon
        if col.isPrimaryKey {
            let badge = NSAttributedString(string: "PK", attributes: [
                .font: NSFont.systemFont(ofSize: 8, weight: .bold),
                .foregroundColor: pkBadge
            ])
            badge.draw(at: CGPoint(x: x + leftPad, y: y + 4))
        } else if col.foreignKey != nil {
            let badge = NSAttributedString(string: "FK", attributes: [
                .font: NSFont.systemFont(ofSize: 8, weight: .bold),
                .foregroundColor: fkBadge
            ])
            badge.draw(at: CGPoint(x: x + leftPad, y: y + 4))
        }

        // Column name
        let nameX = x + leftPad + iconWidth
        let name = NSAttributedString(string: col.name, attributes: [
            .font: NSFont.systemFont(ofSize: 11, weight: col.isPrimaryKey ? .medium : .regular),
            .foregroundColor: columnText
        ])
        let nameSize = name.size()
        name.draw(in: CGRect(x: nameX, y: y + 3, width: width - iconWidth - 80, height: nameSize.height))

        // Data type — right aligned
        let shortType = abbreviateType(col.dataType)
        let typeStr = NSAttributedString(string: shortType, attributes: [
            .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .regular),
            .foregroundColor: typeText
        ])
        let typeSize = typeStr.size()
        typeStr.draw(at: CGPoint(x: x + width - typeSize.width - 10, y: y + 4))

        // Nullable dot
        if !col.isNullable {
            ctx.setFillColor(NSColor.systemOrange.withAlphaComponent(0.6).cgColor)
            ctx.fillEllipse(in: CGRect(x: x + width - typeSize.width - 18, y: y + 8, width: 5, height: 5))
        }
    }

    private func abbreviateType(_ type: String) -> String {
        let t = type.lowercased()
        if t.hasPrefix("character varying") || t.hasPrefix("varchar") {
            let num = t.components(separatedBy: CharacterSet.decimalDigits.inverted)
                .joined().prefix(6)
            return num.isEmpty ? "varchar" : "varchar(\(num))"
        }
        if t.hasPrefix("timestamp") { return "timestamp" }
        if t.hasPrefix("double") { return "double" }
        if t == "integer" { return "int" }
        if t == "boolean" { return "bool" }
        if t == "bigint" { return "bigint" }
        if t == "smallint" { return "smallint" }
        if t == "text" { return "text" }
        if t == "uuid" { return "uuid" }
        if t == "jsonb" { return "jsonb" }
        if t == "json" { return "json" }
        return String(type.prefix(16))
    }

    // MARK: - Relationships

    private func drawRelationship(ctx: CGContext, rel: ERRelationship, isDark: Bool) {
        guard let source = viewModel.tables.first(where: { $0.name == rel.sourceTable }),
              let target = viewModel.tables.first(where: { $0.name == rel.targetTable }) else { return }

        let sourceColIdx = source.columns.firstIndex(where: { $0.name == rel.sourceColumn }) ?? 0
        let targetColIdx = target.columns.firstIndex(where: { $0.name == rel.targetColumn }) ?? 0

        let cardW = Self.cardWidth

        // Source point: right edge of source table at the FK column row
        let sourceY = source.position.y + Self.headerHeight + CGFloat(sourceColIdx) * Self.rowHeight + Self.rowHeight / 2
        // Target point: left edge of target table at the PK column row
        let targetY = target.position.y + Self.headerHeight + CGFloat(targetColIdx) * Self.rowHeight + Self.rowHeight / 2

        // Determine which sides to connect from
        let sourceRight = source.position.x + cardW
        let targetRight = target.position.x + cardW

        let (sx, tx): (CGFloat, CGFloat)
        if source.position.x > target.position.x + cardW {
            // Source is to the right of target
            sx = source.position.x
            tx = targetRight
        } else if target.position.x > sourceRight {
            // Target is to the right of source
            sx = sourceRight
            tx = target.position.x
        } else {
            // Overlapping horizontally — connect from sides that make sense
            sx = sourceRight
            tx = targetRight
        }

        // Draw bezier curve
        let midX = (sx + tx) / 2
        let cp1 = CGPoint(x: midX, y: sourceY)
        let cp2 = CGPoint(x: midX, y: targetY)

        ctx.setStrokeColor(relationshipLine.cgColor)
        ctx.setLineWidth(1.5)
        ctx.setLineDash(phase: 0, lengths: [])

        ctx.move(to: CGPoint(x: sx, y: sourceY))
        ctx.addCurve(to: CGPoint(x: tx, y: targetY), control1: cp1, control2: cp2)
        ctx.strokePath()

        // Draw arrowhead at target
        drawArrowhead(ctx: ctx, at: CGPoint(x: tx, y: targetY), from: cp2)

        // Draw "1" and "N" cardinality markers
        drawCardinalityMarker(ctx: ctx, text: "N", at: CGPoint(x: sx, y: sourceY), side: sx == sourceRight ? .right : .left)
        drawCardinalityMarker(ctx: ctx, text: "1", at: CGPoint(x: tx, y: targetY), side: tx == target.position.x ? .left : .right)
    }

    private enum Side { case left, right }

    private func drawCardinalityMarker(ctx: CGContext, text: String, at point: CGPoint, side: Side) {
        let offset: CGFloat = side == .right ? 6 : -14
        let str = NSAttributedString(string: text, attributes: [
            .font: NSFont.systemFont(ofSize: 9, weight: .bold),
            .foregroundColor: relationshipLine
        ])
        str.draw(at: CGPoint(x: point.x + offset, y: point.y - 14))
    }

    private func drawArrowhead(ctx: CGContext, at point: CGPoint, from control: CGPoint) {
        let angle = atan2(point.y - control.y, point.x - control.x)
        let arrowLen: CGFloat = 8
        let arrowAngle: CGFloat = .pi / 6

        ctx.setFillColor(relationshipLine.cgColor)
        ctx.move(to: point)
        ctx.addLine(to: CGPoint(
            x: point.x - arrowLen * cos(angle - arrowAngle),
            y: point.y - arrowLen * sin(angle - arrowAngle)
        ))
        ctx.addLine(to: CGPoint(
            x: point.x - arrowLen * cos(angle + arrowAngle),
            y: point.y - arrowLen * sin(angle + arrowAngle)
        ))
        ctx.closePath()
        ctx.fillPath()
    }

    // MARK: - Mouse Events

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)

        // Space or Cmd + click = pan the canvas
        if isSpaceDown || event.modifierFlags.contains(.command) {
            isPanning = true
            panOrigin = event.locationInWindow
            NSCursor.closedHand.push()
            return
        }

        viewModel.selectedTableId = nil

        for table in viewModel.tables.reversed() {
            let cardH = Self.cardHeight(for: table)
            let rect = CGRect(origin: table.position, size: CGSize(width: Self.cardWidth, height: cardH))
            if rect.contains(point) {
                if event.clickCount == 2 {
                    NotificationCenter.default.post(
                        name: .erDiagramOpenTable,
                        object: nil,
                        userInfo: ["tableName": table.name, "schema": table.schema as Any]
                    )
                    return
                }
                dragTableId = table.id
                dragOffset = CGPoint(x: point.x - table.position.x, y: point.y - table.position.y)
                viewModel.selectedTableId = table.id
                needsDisplay = true
                return
            }
        }

        // Click on empty space = also pan
        isPanning = true
        panOrigin = event.locationInWindow
        NSCursor.closedHand.push()
    }

    override func mouseDragged(with event: NSEvent) {
        if isPanning {
            guard let clipView = enclosingScrollView?.contentView else { return }
            let current = event.locationInWindow
            let dx = panOrigin.x - current.x
            let dy = current.y - panOrigin.y  // flipped
            var origin = clipView.bounds.origin
            origin.x += dx
            origin.y += dy
            clipView.scroll(to: origin)
            enclosingScrollView?.reflectScrolledClipView(clipView)
            panOrigin = current
            return
        }

        guard let id = dragTableId else { return }
        let point = convert(event.locationInWindow, from: nil)
        let newPos = CGPoint(
            x: max(0, point.x - dragOffset.x),
            y: max(0, point.y - dragOffset.y)
        )
        viewModel.moveTable(id: id, to: newPos)
    }

    override func mouseUp(with event: NSEvent) {
        if isPanning {
            isPanning = false
            NSCursor.pop()
        }
        dragTableId = nil
    }

    override var acceptsFirstResponder: Bool { true }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 49 { // Space
            if !isSpaceDown {
                isSpaceDown = true
                NSCursor.openHand.push()
            }
        } else {
            super.keyDown(with: event)
        }
    }

    override func keyUp(with event: NSEvent) {
        if event.keyCode == 49 {
            isSpaceDown = false
            NSCursor.pop()
        } else {
            super.keyUp(with: event)
        }
    }

    override func scrollWheel(with event: NSEvent) {
        guard event.modifierFlags.contains(.command),
              let scrollView = enclosingScrollView else {
            super.scrollWheel(with: event)
            return
        }

        // Cmd+scroll = zoom centered on cursor
        let delta = event.scrollingDeltaY * (event.hasPreciseScrollingDeltas ? 0.005 : 0.05)
        let newMag = min(scrollView.maxMagnification,
                         max(scrollView.minMagnification,
                             scrollView.magnification + delta))
        scrollView.magnification = newMag
        viewModel.zoom = Float(newMag)
    }

    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        var newHovered: String?
        for table in viewModel.tables.reversed() {
            let cardH = Self.cardHeight(for: table)
            let rect = CGRect(origin: table.position, size: CGSize(width: Self.cardWidth, height: cardH))
            if rect.contains(point) {
                newHovered = table.id
                break
            }
        }
        if newHovered != hoveredTableId {
            hoveredTableId = newHovered
            needsDisplay = true
        }
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas { removeTrackingArea(area) }
        addTrackingArea(NSTrackingArea(
            rect: bounds,
            options: [.activeInKeyWindow, .mouseMoved, .inVisibleRect],
            owner: self
        ))
    }

}

extension Notification.Name {
    static let erDiagramOpenTable = Notification.Name("Gridex.erDiagramOpenTable")
}
