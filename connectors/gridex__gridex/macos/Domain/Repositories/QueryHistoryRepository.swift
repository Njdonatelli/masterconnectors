// QueryHistoryRepository.swift
// Gridex

import Foundation

protocol QueryHistoryRepository: Sendable {
    func save(entry: QueryHistoryEntry) async throws
    func fetchRecent(connectionId: UUID, limit: Int) async throws -> [QueryHistoryEntry]
    func search(query: String, connectionId: UUID?) async throws -> [QueryHistoryEntry]
    func toggleFavorite(id: UUID) async throws
    func delete(id: UUID) async throws
    func deleteAll(connectionId: UUID) async throws
}

struct QueryHistoryEntry: Sendable, Identifiable {
    let id: UUID
    let connectionId: UUID
    let database: String
    let sql: String
    let executedAt: Date
    let duration: TimeInterval
    let rowCount: Int?
    let status: QueryStatus
    let errorMessage: String?
    var isFavorite: Bool

    enum QueryStatus: String, Sendable {
        case success
        case error
    }
}
