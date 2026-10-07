// QueryEngine.swift
// Gridex
//
// Central query execution engine.
// Manages query lifecycle: parse, validate, execute, track history.

import Foundation

actor QueryEngine {
    private let connectionManager: ConnectionManager
    private let historyRepository: any QueryHistoryRepository
    private var runningQueries: [UUID: Task<QueryResult, Error>] = [:]

    init(connectionManager: ConnectionManager, historyRepository: any QueryHistoryRepository) {
        self.connectionManager = connectionManager
        self.historyRepository = historyRepository
    }

    func execute(sql: String, connectionId: UUID, parameters: [QueryParameter]? = nil) async throws -> QueryResult {
        let queryId = UUID()
        let startTime = CFAbsoluteTimeGetCurrent()

        guard let connection = await connectionManager.activeConnection(for: connectionId) else {
            throw GridexError.connectionFailed(underlying: NSError(domain: "QueryEngine", code: -1, userInfo: [NSLocalizedDescriptionKey: "No active connection"]))
        }

        let task = Task {
            try await connection.adapter.execute(query: sql, parameters: parameters)
        }

        runningQueries[queryId] = task

        do {
            let result = try await task.value
            runningQueries[queryId] = nil

            let duration = CFAbsoluteTimeGetCurrent() - startTime
            let dbName = try? await connection.adapter.currentDatabase()

            try? await historyRepository.save(entry: QueryHistoryEntry(
                id: queryId,
                connectionId: connectionId,
                database: dbName ?? "",
                sql: sql,
                executedAt: Date(),
                duration: duration,
                rowCount: result.rowCount,
                status: .success,
                errorMessage: nil,
                isFavorite: false
            ))

            return result
        } catch {
            runningQueries[queryId] = nil

            let duration = CFAbsoluteTimeGetCurrent() - startTime
            let dbName = try? await connection.adapter.currentDatabase()

            try? await historyRepository.save(entry: QueryHistoryEntry(
                id: queryId,
                connectionId: connectionId,
                database: dbName ?? "",
                sql: sql,
                executedAt: Date(),
                duration: duration,
                rowCount: nil,
                status: .error,
                errorMessage: error.localizedDescription,
                isFavorite: false
            ))

            throw error
        }
    }

    func cancel(queryId: UUID) {
        runningQueries[queryId]?.cancel()
        runningQueries[queryId] = nil
    }

    func cancelAll() {
        runningQueries.values.forEach { $0.cancel() }
        runningQueries.removeAll()
    }
}
