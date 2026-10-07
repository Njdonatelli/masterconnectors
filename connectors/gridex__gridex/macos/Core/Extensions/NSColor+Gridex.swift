// Color+Gridex.swift
// Gridex
//
// App-specific color constants with dark mode support.

import SwiftUI
import AppKit

extension Color {
    enum Gridex {
        // Syntax highlighting
        static let syntaxKeyword = Color(red: 0.325, green: 0.290, blue: 0.718)
        static let syntaxString = Color(red: 0.388, green: 0.600, blue: 0.133)
        static let syntaxNumber = Color(red: 0.847, green: 0.353, blue: 0.188)
        static let syntaxComment = Color(red: 0.533, green: 0.533, blue: 0.502)
        static let syntaxFunction = Color(red: 0.216, green: 0.541, blue: 0.867)
        static let syntaxOperator = Color(red: 0.831, green: 0.325, blue: 0.494)

        // Data grid (adaptive)
        static let cellModified = Color(nsColor: NSColor.Gridex.cellModified)
        static let cellNew = Color(nsColor: NSColor.Gridex.cellNew)
        static let cellDeleted = Color(nsColor: NSColor.Gridex.cellDeleted)
        static let cellNull = Color(red: 0.533, green: 0.533, blue: 0.502)
    }
}

// NSColor bridge — appearance-aware data grid colors
extension NSColor {
    enum Gridex {
        static let syntaxKeyword = NSColor(calibratedRed: 0.325, green: 0.290, blue: 0.718, alpha: 1.0)
        static let syntaxString = NSColor(calibratedRed: 0.388, green: 0.600, blue: 0.133, alpha: 1.0)
        static let syntaxNumber = NSColor(calibratedRed: 0.847, green: 0.353, blue: 0.188, alpha: 1.0)
        static let syntaxComment = NSColor(calibratedRed: 0.533, green: 0.533, blue: 0.502, alpha: 1.0)
        static let syntaxFunction = NSColor(calibratedRed: 0.216, green: 0.541, blue: 0.867, alpha: 1.0)
        static let syntaxOperator = NSColor(calibratedRed: 0.831, green: 0.325, blue: 0.494, alpha: 1.0)

        // Light: light beige  |  Dark: dark amber-brown
        static let cellModified = NSColor(name: "cellModified") { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(calibratedRed: 0.25, green: 0.20, blue: 0.10, alpha: 1.0)
                : NSColor(calibratedRed: 0.980, green: 0.933, blue: 0.855, alpha: 1.0)
        }

        // Light: light green  |  Dark: dark green
        static let cellNew = NSColor(name: "cellNew") { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(calibratedRed: 0.10, green: 0.20, blue: 0.10, alpha: 1.0)
                : NSColor(calibratedRed: 0.918, green: 0.953, blue: 0.871, alpha: 1.0)
        }

        // Light: light red  |  Dark: dark red
        static let cellDeleted = NSColor(name: "cellDeleted") { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(calibratedRed: 0.25, green: 0.10, blue: 0.10, alpha: 1.0)
                : NSColor(calibratedRed: 0.988, green: 0.922, blue: 0.922, alpha: 1.0)
        }

        static let cellNull = NSColor(calibratedRed: 0.533, green: 0.533, blue: 0.502, alpha: 1.0)
    }
}
