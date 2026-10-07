// TableStructureView.swift
// Gridex
//
// SwiftUI table structure inspector: Columns | Indexes | Foreign Keys | Constraints.

import SwiftUI

struct TableStructureView: View {
    let tableName: String
    let schema: String?

    @EnvironmentObject private var appState: AppState
    @State private var tableDescription: TableDescription?
    @State private var selectedTab = 0
    @State private var isLoading = false
    @State private var loadError: String?

    var body: some View {
        VStack(spacing: 0) {
            // Tab picker
            Picker("", selection: $selectedTab) {
                Text("Columns").tag(0)
                Text("Indexes").tag(1)
                Text("Foreign Keys").tag(2)
                Text("Constraints").tag(3)
            }
            .pickerStyle(.segmented)
            .padding(8)

            Divider()

            if isLoading {
                ProgressView("Loading structure...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let desc = tableDescription {
                switch selectedTab {
                case 0: columnsTab(desc)
                case 1: indexesTab(desc)
                case 2: foreignKeysTab(desc)
                case 3: constraintsTab(desc)
                default: EmptyView()
                }
            } else {
                VStack(spacing: 8) {
                    Text("Failed to load table structure")
                        .foregroundStyle(.secondary)
                    if let err = loadError {
                        Text(err).font(.system(size: 11)).foregroundStyle(.red).textSelection(.enabled)
                    }
                    Button("Retry") { Task { await loadStructure() } }
                        .controlSize(.small)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task {
            await loadStructure()
        }
    }

    private func loadStructure() async {
        guard let adapter = appState.activeAdapter else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            tableDescription = try await adapter.describeTable(name: tableName, schema: schema)
        } catch {
            loadError = error.localizedDescription
        }
    }

    @ViewBuilder
    private func columnsTab(_ desc: TableDescription) -> some View {
        Table(desc.columns) {
            TableColumn("Name", value: \.name)
            TableColumn("Type", value: \.dataType)
            TableColumn("Nullable") { col in
                Image(systemName: col.isNullable ? "checkmark" : "xmark")
                    .foregroundStyle(col.isNullable ? .green : .red)
            }
            .width(60)
            TableColumn("Default") { col in
                Text(col.defaultValue ?? "—")
                    .foregroundStyle(.secondary)
            }
            TableColumn("PK") { col in
                if col.isPrimaryKey {
                    Image(systemName: "key.fill")
                        .foregroundStyle(.yellow)
                }
            }
            .width(40)
        }
    }

    @ViewBuilder
    private func indexesTab(_ desc: TableDescription) -> some View {
        if desc.indexes.isEmpty {
            Text("No indexes")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Table(desc.indexes) {
                TableColumn("Name", value: \.name)
                TableColumn("Columns") { idx in
                    Text(idx.columns.joined(separator: ", "))
                }
                TableColumn("Unique") { idx in
                    Image(systemName: idx.isUnique ? "checkmark" : "xmark")
                        .foregroundStyle(idx.isUnique ? .green : .secondary)
                }
                .width(60)
            }
        }
    }

    @ViewBuilder
    private func foreignKeysTab(_ desc: TableDescription) -> some View {
        if desc.foreignKeys.isEmpty {
            Text("No foreign keys")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Table(desc.foreignKeys) {
                TableColumn("Column", value: \.column)
                TableColumn("References") { fk in
                    Text("\(fk.referencedTable).\(fk.referencedColumn)")
                }
                TableColumn("On Delete") { fk in
                    Text(fk.onDelete.rawValue)
                        .foregroundStyle(.secondary)
                }
                TableColumn("On Update") { fk in
                    Text(fk.onUpdate.rawValue)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private func constraintsTab(_ desc: TableDescription) -> some View {
        // Combine primary keys and unique constraints
        let items = desc.primaryKeyColumns.map { col in
            ConstraintDisplayItem(name: "PRIMARY KEY", type: "Primary Key", columns: col.name)
        }
        if items.isEmpty {
            Text("No constraints")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(items) { item in
                HStack {
                    Image(systemName: "key.fill")
                        .foregroundStyle(.yellow)
                    VStack(alignment: .leading) {
                        Text(item.type)
                            .font(.system(size: 13, weight: .medium))
                        Text(item.columns)
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

private struct ConstraintDisplayItem: Identifiable {
    let id = UUID()
    let name: String
    let type: String
    let columns: String
}
