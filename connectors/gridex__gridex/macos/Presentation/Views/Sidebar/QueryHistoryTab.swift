// QueryHistoryTab.swift
// Gridex
//
// Sidebar tab showing SQL query history persisted via SwiftData.
// Only records queries run from the SQL editor (not data grid loads).

import SwiftUI
import AppKit

struct QueryHistoryTab: View {
    @EnvironmentObject private var appState: AppState
    @State private var entries: [QueryHistoryEntry] = []
    @State private var searchText = ""
    @State private var isLoading = false
    @State private var hoveredId: UUID?

    var body: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                TextField("Search history…", text: $searchText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .onSubmit { Task { await reload() } }
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                        Task { await reload() }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .pointerCursor()
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(Color(NSColor.windowBackgroundColor))

            Divider()

            if isLoading {
                ProgressView().controlSize(.small)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if entries.isEmpty {
                emptyState
            } else {
                list
            }

            Divider()

            // Footer
            HStack {
                Text("\(entries.count) \(entries.count == 1 ? "entry" : "entries")")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                Spacer()
                Button {
                    Task { await clearAll() }
                } label: {
                    HStack(spacing: 3) {
                        Image(systemName: "trash")
                            .font(.system(size: 10))
                        Text("Clear")
                            .font(.system(size: 10))
                    }
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .pointerCursor()
                .help("Clear history for this connection")
                .disabled(entries.isEmpty)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
        }
        .task { await reload() }
        .onChange(of: appState.activeConnectionId) { _, _ in
            Task { await reload() }
        }
        .onChange(of: appState.queryHistoryVersion) { _, _ in
            Task { await reload() }
        }
        .onChange(of: searchText) { _, _ in
            Task { await reload() }
        }
    }

    // MARK: - Subviews

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 32))
                .foregroundStyle(.tertiary)
            Text("No query history")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
            Text("Run a query in the SQL editor to see it here")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                ForEach(groupedByDay, id: \.key) { group in
                    Section {
                        ForEach(group.entries) { entry in
                            HistoryRow(
                                entry: entry,
                                isHovered: hoveredId == entry.id,
                                onPaste: { paste(entry) },
                                onCopy: { copy(entry) },
                                onToggleFavorite: { Task { await toggleFavorite(entry) } },
                                onDelete: { Task { await delete(entry) } }
                            )
                            .onHover { hovering in
                                hoveredId = hovering ? entry.id : nil
                            }
                        }
                    } header: {
                        SectionHeader(title: group.key, count: group.entries.count)
                    }
                }
            }
        }
        .background(Color(NSColor.windowBackgroundColor))
    }

    // MARK: - Grouping

    private var groupedByDay: [(key: String, entries: [QueryHistoryEntry])] {
        let cal = Calendar.current
        let now = Date()
        var groups: [(String, [QueryHistoryEntry])] = []
        var currentKey: String? = nil
        var currentList: [QueryHistoryEntry] = []

        for entry in entries {
            let key: String
            if cal.isDateInToday(entry.executedAt) {
                key = "Today"
            } else if cal.isDateInYesterday(entry.executedAt) {
                key = "Yesterday"
            } else if cal.dateComponents([.day], from: entry.executedAt, to: now).day ?? 0 <= 7 {
                let df = DateFormatter()
                df.dateFormat = "EEEE"
                key = df.string(from: entry.executedAt)
            } else {
                let df = DateFormatter()
                df.dateFormat = "MMM d, yyyy"
                key = df.string(from: entry.executedAt)
            }

            if currentKey == nil || currentKey == key {
                currentKey = key
                currentList.append(entry)
            } else {
                if let k = currentKey { groups.append((k, currentList)) }
                currentKey = key
                currentList = [entry]
            }
        }
        if let k = currentKey { groups.append((k, currentList)) }
        return groups
    }

    // MARK: - Actions

    private func reload() async {
        guard let connectionId = appState.activeConnectionId else {
            entries = []
            return
        }
        isLoading = true
        defer { isLoading = false }

        let repo = appState.container.queryHistoryRepository
        do {
            if searchText.trimmingCharacters(in: .whitespaces).isEmpty {
                entries = try await repo.fetchRecent(connectionId: connectionId, limit: 200)
            } else {
                entries = try await repo.search(query: searchText, connectionId: connectionId)
            }
        } catch {
            entries = []
        }
    }

    private func paste(_ entry: QueryHistoryEntry) {
        NotificationCenter.default.post(
            name: .init("pasteQueryToEditor"),
            object: nil,
            userInfo: ["sql": entry.sql]
        )
    }

    private func copy(_ entry: QueryHistoryEntry) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(entry.sql, forType: .string)
    }

    private func toggleFavorite(_ entry: QueryHistoryEntry) async {
        let repo = appState.container.queryHistoryRepository
        try? await repo.toggleFavorite(id: entry.id)
        await reload()
    }

    private func delete(_ entry: QueryHistoryEntry) async {
        let repo = appState.container.queryHistoryRepository
        try? await repo.delete(id: entry.id)
        await reload()
    }

    private func clearAll() async {
        guard let connectionId = appState.activeConnectionId else { return }
        let repo = appState.container.queryHistoryRepository
        try? await repo.deleteAll(connectionId: connectionId)
        await reload()
    }
}

// MARK: - Section Header

private struct SectionHeader: View {
    let title: String
    let count: Int

    var body: some View {
        HStack {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
            Text("·")
                .foregroundStyle(.tertiary)
            Text("\(count)")
                .font(.system(size: 10))
                .foregroundStyle(.tertiary)
            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color(NSColor.windowBackgroundColor).opacity(0.95))
    }
}

// MARK: - History Row

private struct HistoryRow: View {
    let entry: QueryHistoryEntry
    let isHovered: Bool
    let onPaste: () -> Void
    let onCopy: () -> Void
    let onToggleFavorite: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Top row: status dot + time + duration + rows + fav
            HStack(spacing: 6) {
                Circle()
                    .fill(entry.status == .success ? Color.green : Color.red)
                    .frame(width: 6, height: 6)

                Text(timeString)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)

                if entry.duration > 0 {
                    Text("·")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                    Text(durationString)
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }

                if let rows = entry.rowCount {
                    Text("·")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                    Text("\(rows) \(rows == 1 ? "row" : "rows")")
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                }

                Spacer()

                if entry.isFavorite {
                    Image(systemName: "star.fill")
                        .font(.system(size: 9))
                        .foregroundStyle(.yellow)
                }

                // Hover actions
                if isHovered {
                    Button(action: onCopy) {
                        Image(systemName: "doc.on.doc")
                            .font(.system(size: 10))
                    }
                    .buttonStyle(.plain)
                    .pointerCursor()
                    .help("Copy SQL")

                    Button(action: onPaste) {
                        Image(systemName: "arrow.up.doc")
                            .font(.system(size: 10))
                    }
                    .buttonStyle(.plain)
                    .pointerCursor()
                    .help("Paste to editor")
                }
            }

            // SQL preview with keyword highlighting
            Text(highlightedSQL)
                .font(.system(size: 11, design: .monospaced))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            // Error message (if any)
            if let err = entry.errorMessage, !err.isEmpty {
                Text(err)
                    .font(.system(size: 10))
                    .foregroundStyle(.red.opacity(0.8))
                    .lineLimit(2)
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            isHovered ? Color.primary.opacity(0.05) : Color.clear
        )
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { onPaste() }
        .contextMenu {
            Button("Paste to Editor", action: onPaste)
            Button("Copy SQL", action: onCopy)
            Divider()
            Button(entry.isFavorite ? "Unfavorite" : "Favorite", action: onToggleFavorite)
            Divider()
            Button("Delete", role: .destructive, action: onDelete)
        }
    }

    private var timeString: String {
        let df = DateFormatter()
        df.dateFormat = "HH:mm:ss"
        return df.string(from: entry.executedAt)
    }

    private var durationString: String {
        let ms = entry.duration * 1000
        if ms < 1 { return "<1ms" }
        if ms < 1000 { return String(format: "%.0fms", ms) }
        return String(format: "%.2fs", entry.duration)
    }

    /// Collapse whitespace and highlight SQL keywords in color.
    private var highlightedSQL: AttributedString {
        let collapsed = entry.sql
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\t", with: " ")
            .components(separatedBy: " ")
            .filter { !$0.isEmpty }
            .joined(separator: " ")

        var result = AttributedString(collapsed)
        result.foregroundColor = .primary

        let keywords = [
            "SELECT", "FROM", "WHERE", "JOIN", "LEFT JOIN", "RIGHT JOIN",
            "INNER JOIN", "ON", "AND", "OR", "ORDER BY", "GROUP BY",
            "HAVING", "LIMIT", "OFFSET", "INSERT INTO", "VALUES",
            "UPDATE", "SET", "DELETE FROM", "CREATE TABLE", "ALTER TABLE",
            "DROP TABLE", "WITH", "AS", "DISTINCT", "UNION", "EXISTS",
            "IN", "NOT", "NULL", "IS", "LIKE", "BETWEEN", "CASE",
            "WHEN", "THEN", "ELSE", "END", "RETURNING", "EXPLAIN"
        ]

        let upper = collapsed.uppercased()
        for kw in keywords {
            var searchRange = upper.startIndex..<upper.endIndex
            while let range = upper.range(of: kw, options: .literal, range: searchRange) {
                // Check word boundaries
                let before = range.lowerBound == upper.startIndex || !upper[upper.index(before: range.lowerBound)].isLetter
                let afterIdx = range.upperBound
                let after = afterIdx == upper.endIndex || !upper[afterIdx].isLetter
                if before && after {
                    let start = collapsed.distance(from: collapsed.startIndex, to: range.lowerBound)
                    let length = kw.count
                    if let attrRange = Range(NSRange(location: start, length: length), in: result) {
                        result[attrRange].foregroundColor = Color(red: 0.53, green: 0.33, blue: 0.87)
                        result[attrRange].font = .system(size: 11, weight: .semibold, design: .monospaced)
                    }
                }
                searchRange = range.upperBound..<upper.endIndex
            }
        }

        return result
    }
}
