// AppConstants.swift
// Gridex

import Foundation

enum AppConstants {
    static let appName = "Gridex"
    static let bundleIdentifier = "com.gridex.app"

    enum Defaults {
        static let pageSize = 500
        static let sidebarWidth: Double = 240
        static let aiPanelWidth: Double = 320
        static let schemaRefreshInterval: TimeInterval = 300 // 5 minutes
        static let maxQueryTimeout: TimeInterval = 30
    }

    enum AI {
        static let defaultModel = "claude-sonnet-4-6"
        static let defaultProvider = "anthropic"
        static let defaultMaxTokens = 4096
        static let defaultTemperature = 0.3
        static let maxContextTokens = 100000
    }

    enum UI {
        static let minWindowWidth: CGFloat = 900
        static let minWindowHeight: CGFloat = 500
        static let defaultWindowWidth: CGFloat = 1200
        static let defaultWindowHeight: CGFloat = 700
        static let rowHeight: CGFloat = 28
        static let headerHeight: CGFloat = 32
        static let statusBarHeight: CGFloat = 24
        static let tabBarHeight: CGFloat = 32
    }
}
