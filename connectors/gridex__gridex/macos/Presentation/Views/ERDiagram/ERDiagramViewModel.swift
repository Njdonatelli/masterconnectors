// ERDiagramViewModel.swift
// Gridex
//
// Loads table metadata and manages layout state for the ER diagram.

import SwiftUI
import AppKit

// MARK: - Models

struct ERTable: Identifiable {
    let id: String  // table name
    let name: String
    let schema: String?
    let columns: [ERColumn]
    var position: CGPoint = .zero

    var primaryKeys: [ERColumn] { columns.filter(\.isPrimaryKey) }
    var foreignKeys: [ERColumn] { columns.filter { $0.foreignKey != nil } }
}

struct ERColumn: Identifiable {
    let id: String  // column name
    let name: String
    let dataType: String
    let isPrimaryKey: Bool
    let isNullable: Bool
    let foreignKey: ERForeignKey?
}

struct ERForeignKey {
    let referencedTable: String
    let referencedColumn: String
}

struct ERRelationship: Identifiable {
    var id: String { "\(sourceTable).\(sourceColumn)->\(targetTable).\(targetColumn)" }
    let sourceTable: String
    let sourceColumn: String
    let targetTable: String
    let targetColumn: String
    let name: String?
}

// MARK: - ViewModel

@MainActor
final class ERDiagramViewModel: ObservableObject {
    @Published var tables: [ERTable] = []
    @Published var relationships: [ERRelationship] = []
    @Published var isLoading = false
    @Published var loadError: String?
    @Published var zoom: Float = 1.0
    @Published var selectedTableId: String?

    var needsInitialLayout = true
    weak var canvas: ERDiagramCanvas?

    // MARK: - Load

    func load(adapter: any DatabaseAdapter, schema: String?) async {
        isLoading = true
        defer { isLoading = false }

        do {
            let tableInfos = try await adapter.listTables(schema: schema)
            var erTables: [ERTable] = []
            var erRelationships: [ERRelationship] = []

            // Fetch all table descriptions in parallel
            try await withThrowingTaskGroup(of: (TableDescription?).self) { group in
                for info in tableInfos where info.type == .table {
                    group.addTask {
                        try? await adapter.describeTable(name: info.name, schema: schema)
                    }
                }
                for try await desc in group {
                    guard let desc else { continue }

                    // Build FK lookup for this table
                    var fkLookup: [String: ERForeignKey] = [:]
                    for fk in desc.foreignKeys {
                        for (i, col) in fk.columns.enumerated() {
                            let refCol = i < fk.referencedColumns.count ? fk.referencedColumns[i] : fk.referencedColumns.first ?? ""
                            fkLookup[col] = ERForeignKey(referencedTable: fk.referencedTable, referencedColumn: refCol)

                            erRelationships.append(ERRelationship(
                                sourceTable: desc.name,
                                sourceColumn: col,
                                targetTable: fk.referencedTable,
                                targetColumn: refCol,
                                name: fk.name
                            ))
                        }
                    }

                    let columns = desc.columns.sorted(by: { $0.ordinalPosition < $1.ordinalPosition }).map { col in
                        ERColumn(
                            id: col.name,
                            name: col.name,
                            dataType: col.dataType,
                            isPrimaryKey: col.isPrimaryKey,
                            isNullable: col.isNullable,
                            foreignKey: fkLookup[col.name]
                        )
                    }

                    erTables.append(ERTable(
                        id: desc.name,
                        name: desc.name,
                        schema: desc.schema,
                        columns: columns
                    ))
                }
            }

            tables = erTables.sorted(by: { $0.name < $1.name })
            relationships = erRelationships
            needsInitialLayout = true
        } catch {
            loadError = error.localizedDescription
        }
    }

    // MARK: - Layout

    func autoLayout() {
        guard !tables.isEmpty else { return }

        // Build adjacency: tables connected by FK
        var adjacency: [String: Set<String>] = [:]
        for t in tables { adjacency[t.name] = [] }
        for r in relationships {
            adjacency[r.sourceTable, default: []].insert(r.targetTable)
            adjacency[r.targetTable, default: []].insert(r.sourceTable)
        }

        // Topological sort / layered layout (Sugiyama-lite)
        var layers: [[String]] = []
        var assigned: Set<String> = []

        // Start with tables that have no incoming FKs (root/referenced tables)
        let targets = Set(relationships.map(\.targetTable))
        let sources = Set(relationships.map(\.sourceTable))
        var roots = tables.filter { targets.contains($0.name) && !sources.contains($0.name) }.map(\.name)
        if roots.isEmpty {
            // No pure roots — pick tables with most references
            roots = tables.sorted { (adjacency[$0.name]?.count ?? 0) > (adjacency[$1.name]?.count ?? 0) }
                .prefix(max(1, tables.count / 4)).map(\.name)
        }

        // BFS layering
        var queue = roots
        assigned.formUnion(roots)
        while !queue.isEmpty {
            layers.append(queue)
            var next: [String] = []
            for node in queue {
                for neighbor in (adjacency[node] ?? []) where !assigned.contains(neighbor) {
                    next.append(neighbor)
                    assigned.insert(neighbor)
                }
            }
            queue = next
        }
        // Any unassigned tables go in a final layer
        let remaining = tables.filter { !assigned.contains($0.name) }.map(\.name)
        if !remaining.isEmpty { layers.append(remaining) }

        // Position tables in a grid
        let cardW: CGFloat = ERDiagramCanvas.cardWidth
        let hGap: CGFloat = 80
        let vGap: CGFloat = 60
        let padding: CGFloat = 60

        var x = padding
        for layer in layers {
            var y = padding
            for name in layer {
                if let idx = tables.firstIndex(where: { $0.name == name }) {
                    let h = ERDiagramCanvas.cardHeight(for: tables[idx])
                    tables[idx].position = CGPoint(x: x, y: y)
                    y += h + vGap
                }
            }
            x += cardW + hGap
        }

        canvas?.needsDisplay = true
        objectWillChange.send()
    }

    func fitToView() {
        guard let canvas, let scrollView = canvas.enclosingScrollView, !tables.isEmpty else { return }

        let bounds = tableBounds()
        let visibleSize = scrollView.contentView.bounds.size
        guard bounds.width > 0 && bounds.height > 0 else { return }

        let scaleX = visibleSize.width / (bounds.width + 120)
        let scaleY = visibleSize.height / (bounds.height + 120)
        let newZoom = Float(min(scaleX, scaleY, 1.5))
        zoom = max(0.1, newZoom)
        scrollView.magnification = CGFloat(zoom)

        // Center
        let centerX = bounds.midX * CGFloat(zoom) - visibleSize.width / 2
        let centerY = bounds.midY * CGFloat(zoom) - visibleSize.height / 2
        scrollView.contentView.scroll(to: NSPoint(x: max(0, centerX), y: max(0, centerY)))
    }

    func zoomIn() {
        zoom = min(3.0, zoom + 0.15)
        canvas?.enclosingScrollView?.magnification = CGFloat(zoom)
    }

    func zoomOut() {
        zoom = max(0.1, zoom - 0.15)
        canvas?.enclosingScrollView?.magnification = CGFloat(zoom)
    }

    func tableBounds() -> CGRect {
        guard !tables.isEmpty else { return .zero }
        var minX = CGFloat.infinity, minY = CGFloat.infinity
        var maxX = -CGFloat.infinity, maxY = -CGFloat.infinity
        for t in tables {
            let h = ERDiagramCanvas.cardHeight(for: t)
            minX = min(minX, t.position.x)
            minY = min(minY, t.position.y)
            maxX = max(maxX, t.position.x + ERDiagramCanvas.cardWidth)
            maxY = max(maxY, t.position.y + h)
        }
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }

    func moveTable(id: String, to point: CGPoint) {
        if let idx = tables.firstIndex(where: { $0.id == id }) {
            tables[idx].position = point
            canvas?.needsDisplay = true
        }
    }
}
