// CompletionWindow.swift
// Gridex
//
// Simple NSStackView-based autocomplete popup. No scroll view, no table view.
// Max 10 items — all rendered inline as NSStackView rows.

import AppKit

final class CompletionWindow: NSPanel {
    private let stackView = NSStackView()
    private let footerLabel = NSTextField(labelWithString: "")
    private var items: [CompletionItem] = []
    private var rowViews: [CompletionRowView] = []
    private var selectedIndex: Int = 0
    var onSelect: ((CompletionItem) -> Void)?

    private let rowHeight: CGFloat = 28
    private let maxRows = 10
    private let windowWidth: CGFloat = 420
    private let footerHeight: CGFloat = 22
    private let topPadding: CGFloat = 4
    private let bottomPadding: CGFloat = 4

    override var canBecomeKey: Bool { false }

    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 100),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )

        isOpaque = false
        backgroundColor = .clear
        level = .floating
        hasShadow = true
        isMovableByWindowBackground = false
        hidesOnDeactivate = true

        setupUI()
    }

    private func setupUI() {
        let container = NSVisualEffectView(frame: contentView!.bounds)
        container.material = .popover
        container.state = .active
        container.blendingMode = .behindWindow
        container.wantsLayer = true
        container.layer?.cornerRadius = 6
        container.layer?.masksToBounds = true
        container.autoresizingMask = [.width, .height]
        contentView?.addSubview(container)

        // Vertical stack of rows
        stackView.orientation = .vertical
        stackView.alignment = .leading
        stackView.distribution = .fill
        stackView.spacing = 0
        stackView.translatesAutoresizingMaskIntoConstraints = false

        // Footer
        footerLabel.font = NSFont.systemFont(ofSize: 10)
        footerLabel.textColor = .tertiaryLabelColor
        footerLabel.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(stackView)
        container.addSubview(footerLabel)

        NSLayoutConstraint.activate([
            stackView.topAnchor.constraint(equalTo: container.topAnchor, constant: topPadding),
            stackView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            stackView.trailingAnchor.constraint(equalTo: container.trailingAnchor),

            footerLabel.topAnchor.constraint(equalTo: stackView.bottomAnchor, constant: bottomPadding),
            footerLabel.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 10),
            footerLabel.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -10),
            footerLabel.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -4),
            footerLabel.heightAnchor.constraint(equalToConstant: 14)
        ])
    }

    // MARK: - Public API

    func show(items: [CompletionItem], at screenPoint: NSPoint) {
        let visible = Array(items.prefix(maxRows))
        guard !visible.isEmpty else { dismiss(); return }

        self.items = visible
        self.selectedIndex = 0

        // Rebuild rows
        rowViews.forEach { $0.removeFromSuperview() }
        rowViews.removeAll()

        for (i, item) in visible.enumerated() {
            let row = CompletionRowView(item: item, width: windowWidth, height: rowHeight)
            row.translatesAutoresizingMaskIntoConstraints = false
            row.onClick = { [weak self] in
                self?.selectedIndex = i
                self?.updateSelection()
                self?.onSelect?(item)
            }
            stackView.addArrangedSubview(row)
            NSLayoutConstraint.activate([
                row.widthAnchor.constraint(equalToConstant: windowWidth),
                row.heightAnchor.constraint(equalToConstant: rowHeight)
            ])
            rowViews.append(row)
        }

        updateSelection()

        let tableHeight = CGFloat(visible.count) * rowHeight
        let contentHeight = topPadding + tableHeight + bottomPadding + footerHeight + 4

        setContentSize(NSSize(width: windowWidth, height: contentHeight))

        var origin = NSPoint(x: screenPoint.x, y: screenPoint.y - contentHeight)
        if let screen = NSScreen.main?.visibleFrame {
            let maxX = screen.maxX - windowWidth - 8
            origin.x = min(origin.x, maxX)
            origin.x = max(origin.x, screen.minX + 8)
            if origin.y < screen.minY + 8 {
                origin.y = screenPoint.y + 20
            }
        }
        setFrameOrigin(origin)
        contentView?.layoutSubtreeIfNeeded()

        footerLabel.stringValue = "Press ↩ to insert, ⇥ to replace  ·  \(items.count) items"

        if !isVisible {
            orderFront(nil)
        }
    }

    func dismiss() {
        orderOut(nil)
        items = []
        rowViews.forEach { $0.removeFromSuperview() }
        rowViews.removeAll()
    }

    var isActive: Bool { isVisible && !items.isEmpty }

    var selectedItem: CompletionItem? {
        guard selectedIndex >= 0, selectedIndex < items.count else { return nil }
        return items[selectedIndex]
    }

    func moveSelectionUp() {
        selectedIndex = max(0, selectedIndex - 1)
        updateSelection()
    }

    func moveSelectionDown() {
        selectedIndex = min(items.count - 1, selectedIndex + 1)
        updateSelection()
    }

    private func updateSelection() {
        for (i, row) in rowViews.enumerated() {
            row.setSelected(i == selectedIndex)
        }
    }
}

// MARK: - Completion Row View

private final class CompletionRowView: NSView {
    private let item: CompletionItem
    private let iconLabel = NSTextField(labelWithString: "")
    private let textLabel = NSTextField(labelWithString: "")
    private let detailLabel = NSTextField(labelWithString: "")
    var onClick: (() -> Void)?

    override var isFlipped: Bool { true }

    init(item: CompletionItem, width: CGFloat, height: CGFloat) {
        self.item = item
        super.init(frame: NSRect(x: 0, y: 0, width: width, height: height))
        wantsLayer = true
        layer?.masksToBounds = true
        setupContent(width: width, height: height)
    }

    required init?(coder: NSCoder) { fatalError() }

    private func setupContent(width: CGFloat, height: CGFloat) {
        // Icon badge (18x16, vertically centered)
        let iconHeight: CGFloat = 16
        let iconY = (height - iconHeight) / 2
        iconLabel.stringValue = item.type.icon
        iconLabel.font = NSFont.monospacedSystemFont(ofSize: 9, weight: .bold)
        let c = item.type.iconColor
        iconLabel.textColor = NSColor(red: c.r, green: c.g, blue: c.b, alpha: 1)
        iconLabel.alignment = .center
        iconLabel.wantsLayer = true
        iconLabel.layer?.backgroundColor = NSColor(red: c.r, green: c.g, blue: c.b, alpha: 0.15).cgColor
        iconLabel.layer?.cornerRadius = 3
        iconLabel.frame = NSRect(x: 10, y: iconY, width: 18, height: iconHeight)
        addSubview(iconLabel)

        // Text labels use a tight height (18) centered in the row,
        // so their baseline matches the icon badge center.
        let labelHeight: CGFloat = 18
        let labelY = (height - labelHeight) / 2

        // Detail label (right-aligned)
        detailLabel.attributedStringValue = NSAttributedString(
            string: item.detail ?? "",
            attributes: [
                .font: NSFont.systemFont(ofSize: 10),
                .foregroundColor: NSColor.tertiaryLabelColor
            ]
        )
        detailLabel.alignment = .right
        detailLabel.maximumNumberOfLines = 1
        if let cell = detailLabel.cell as? NSTextFieldCell {
            cell.lineBreakMode = .byTruncatingTail
            cell.usesSingleLineMode = true
            cell.truncatesLastVisibleLine = true
        }
        let detailWidth: CGFloat = 140
        detailLabel.frame = NSRect(x: width - detailWidth - 12, y: labelY, width: detailWidth, height: labelHeight)
        addSubview(detailLabel)

        // Main text
        textLabel.attributedStringValue = highlightedText(for: item)
        textLabel.maximumNumberOfLines = 1
        if let cell = textLabel.cell as? NSTextFieldCell {
            cell.lineBreakMode = .byTruncatingTail
            cell.usesSingleLineMode = true
            cell.truncatesLastVisibleLine = true
        }
        let textX: CGFloat = 10 + 18 + 8
        let textWidth = width - textX - detailWidth - 14
        textLabel.frame = NSRect(x: textX, y: labelY, width: textWidth, height: labelHeight)
        addSubview(textLabel)
    }

    func setSelected(_ selected: Bool) {
        layer?.backgroundColor = selected
            ? NSColor.selectedContentBackgroundColor.withAlphaComponent(0.4).cgColor
            : NSColor.clear.cgColor
    }

    override func mouseDown(with event: NSEvent) {
        onClick?()
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .pointingHand)
    }

    private func highlightedText(for item: CompletionItem) -> NSAttributedString {
        let str = NSMutableAttributedString(
            string: item.text,
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular),
                .foregroundColor: NSColor.labelColor
            ]
        )
        let boldFont = NSFont.monospacedSystemFont(ofSize: 12, weight: .bold)
        for charIndex in item.matchRanges {
            guard charIndex < item.text.count else { continue }
            let nsRange = NSRange(location: charIndex, length: 1)
            str.addAttribute(.font, value: boldFont, range: nsRange)
            str.addAttribute(.foregroundColor, value: NSColor.controlAccentColor, range: nsRange)
        }
        return str
    }
}
