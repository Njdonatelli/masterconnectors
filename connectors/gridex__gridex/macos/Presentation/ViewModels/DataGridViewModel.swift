// DataGridViewModel.swift
// Gridex

import Foundation

@MainActor
final class DataGridViewModel: ObservableObject {
    @Published var columns: [ColumnHeader] = []
    @Published var rows: [[RowValue]] = []
    @Published var totalRows: Int = 0
    @Published var currentPage: Int = 0
    @Published var isLoading: Bool = false
    @Published var executionTime: TimeInterval = 0
    @Published var pendingChangesCount: Int = 0
    @Published var errorMessage: String?

    private let queryEngine: QueryEngine
    private let connectionId: UUID
    private let pageSize: Int

    var tableName: String = ""
    var schema: String?

    init(queryEngine: QueryEngine, connectionId: UUID, pageSize: Int = 500) {
        self.queryEngine = queryEngine
        self.connectionId = connectionId
        self.pageSize = pageSize
    }

    func loadTable(name: String, schema: String? = nil) async {
        self.tableName = name
        self.schema = schema
        await loadPage(0)
    }

    func loadPage(_ page: Int) async {
        isLoading = true
        defer { isLoading = false }

        let offset = page * pageSize
        let sql = "SELECT * FROM \(tableName) LIMIT \(pageSize) OFFSET \(offset)"

        do {
            let result = try await queryEngine.execute(sql: sql, connectionId: connectionId)
            self.columns = result.columns
            self.rows = result.rows
            self.executionTime = result.executionTime
            self.currentPage = page
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func nextPage() async {
        await loadPage(currentPage + 1)
    }

    func previousPage() async {
        guard currentPage > 0 else { return }
        await loadPage(currentPage - 1)
    }

    func refresh() async {
        await loadPage(currentPage)
    }

    func dismissError() {
        errorMessage = nil
    }
}
