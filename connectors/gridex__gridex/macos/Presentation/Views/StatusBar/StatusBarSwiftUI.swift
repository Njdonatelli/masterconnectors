// StatusBarSwiftUI.swift
// Gridex
//
// SwiftUI bottom status bar.

import SwiftUI

struct StatusBarSwiftUIView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        HStack(spacing: 0) {
            statusItem(appState.statusConnection ?? "Not connected")
            separator
            statusItem(appState.statusSchema ?? "")
            separator
            statusItem(appState.statusRowCount.map { "\($0) rows" } ?? "")
            separator
            statusItem(appState.statusQueryTime.map { "\(Int($0 * 1000))ms" } ?? "")

            if let dbSize = appState.redisDBSize {
                separator
                statusItem("\(dbSize) keys")
            }

            Spacer()

            statusItem("v\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0")")
        }
        .padding(.horizontal, 8)
        .frame(height: 24)
        .background(Color(nsColor: .windowBackgroundColor))
        .overlay(alignment: .top) { Divider() }
    }

    private func statusItem(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }

    private var separator: some View {
        Text("|")
            .font(.system(size: 11))
            .foregroundStyle(.quaternary)
            .padding(.horizontal, 6)
    }
}
