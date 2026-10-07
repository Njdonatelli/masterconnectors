// SwiftDataQueryHistoryRepository.swift
// Gridex

import Foundation
import SwiftData

final class SwiftDataQueryHistoryRepository: QueryHistoryRepository, @unchecked Sendable {
    private let modelContainer: ModelContainer

    init(modelContainer: ModelContainer) {
        self.modelContainer = modelContainer
    }

    @MainActor
    func save(entry: QueryHistoryEntry) async throws {
        let context = modelContainer.mainContext
        let entity = QueryHistoryEntity(
            id: entry.id,
            connectionId: entry.connectionId,
            database: entry.database,
            sql: entry.sql,
            executedAt: entry.executedAt,
            duration: entry.duration,
            rowCount: entry.rowCount,
            status: entry.status.rawValue,
            errorMessage: entry.errorMessage,
            isFavorite: entry.isFavorite
        )
        context.insert(entity)
        try context.save()
    }

    @MainActor
    func fetchRecent(connectionId: UUID, limit: Int) async throws -> [QueryHistoryEntry] {
        let context = modelContainer.mainContext
        var descriptor = FetchDescriptor<QueryHistoryEntity>(
            predicate: #Predicate { $0.connectionId == connectionId },
            sortBy: [SortDescriptor(\.executedAt, order: .reverse)]
        )
        descriptor.fetchLimit = limit
        return try context.fetch(descriptor).map { toEntry($0) }
    }

    @MainActor
    func search(query: String, connectionId: UUID?) async throws -> [QueryHistoryEntry] {
        let context = modelContainer.mainContext
        var descriptor: FetchDescriptor<QueryHistoryEntity>
        if let connectionId {
            descriptor = FetchDescriptor<QueryHistoryEntity>(
                predicate: #Predicate { $0.connectionId == connectionId && $0.sql.contains(query) },
                sortBy: [SortDescriptor(\.executedAt, order: .reverse)]
            )
        } else {
            descriptor = FetchDescriptor<QueryHistoryEntity>(
                predicate: #Predicate { $0.sql.contains(query) },
                sortBy: [SortDescriptor(\.executedAt, order: .reverse)]
            )
        }
        descriptor.fetchLimit = 100
        return try context.fetch(descriptor).map { toEntry($0) }
    }

    @MainActor
    func toggleFavorite(id: UUID) async throws {
        let context = modelContainer.mainContext
        var descriptor = FetchDescriptor<QueryHistoryEntity>(
            predicate: #Predicate { $0.id == id }
        )
        descriptor.fetchLimit = 1
        if let entity = try context.fetch(descriptor).first {
            entity.isFavorite.toggle()
            try context.save()
        }
    }

    @MainActor
    func delete(id: UUID) async throws {
        let context = modelContainer.mainContext
        let descriptor = FetchDescriptor<QueryHistoryEntity>(
            predicate: #Predicate { $0.id == id }
        )
        if let entity = try context.fetch(descriptor).first {
            context.delete(entity)
            try context.save()
        }
    }

    @MainActor
    func deleteAll(connectionId: UUID) async throws {
        let context = modelContainer.mainContext
        let descriptor = FetchDescriptor<QueryHistoryEntity>(
            predicate: #Predicate { $0.connectionId == connectionId }
        )
        for entity in try context.fetch(descriptor) {
            context.delete(entity)
        }
        try context.save()
    }

    private func toEntry(_ entity: QueryHistoryEntity) -> QueryHistoryEntry {
        QueryHistoryEntry(
            id: entity.id,
            connectionId: entity.connectionId,
            database: entity.database,
            sql: entity.sql,
            executedAt: entity.executedAt,
            duration: entity.duration,
            rowCount: entity.rowCount,
            status: QueryHistoryEntry.QueryStatus(rawValue: entity.status) ?? .success,
            errorMessage: entity.errorMessage,
            isFavorite: entity.isFavorite
        )
    }
}
