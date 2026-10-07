import SwiftUI
import AppKit

// MARK: - Pointer Cursor on Hover

/// Adds pointingHand cursor when hovering over any interactive element.
struct PointingHandCursor: ViewModifier {
    @State private var isHovering = false

    func body(content: Content) -> some View {
        content
            .onHover { hovering in
                isHovering = hovering
                if hovering {
                    NSCursor.pointingHand.push()
                } else {
                    NSCursor.pop()
                }
            }
    }
}

// MARK: - Clickable Style (cursor + subtle hover highlight)

/// Full clickable treatment: pointer cursor + background highlight on hover.
struct ClickableStyle: ViewModifier {
    var cornerRadius: CGFloat = 4
    @State private var isHovering = false

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(isHovering ? Color.primary.opacity(0.06) : Color.clear)
            )
            .onHover { hovering in
                isHovering = hovering
                if hovering {
                    NSCursor.pointingHand.push()
                } else {
                    NSCursor.pop()
                }
            }
    }
}

// MARK: - View Extension

extension View {
    /// Adds pointingHand cursor on hover.
    func pointerCursor() -> some View {
        modifier(PointingHandCursor())
    }

    /// Adds pointingHand cursor + subtle background highlight on hover.
    func clickable(cornerRadius: CGFloat = 4) -> some View {
        modifier(ClickableStyle(cornerRadius: cornerRadius))
    }
}
