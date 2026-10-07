// SchemaInspectorService.swift
// Gridex
//
// High-level schema inspection with caching.

import Foundation

actor SchemaInspectorService {
    private let cache: SchemaCache
    private let connectionManager: ConnectionManager

    init(cache: SchemaCache, connectionManager: ConnectionManager) {
        self.cache = cache
        self.connectionManager = connectionManager
    }

    func loadSchema(connectionId: UUID, forceRefresh: Bool = false) async throws -> SchemaSnapshot {
        if !forceRefresh, let cached = await cache.get(connectionId: connectionId) {
            return cached
        }

        guard let connection = await connectionManager.activeConnection(for: connectionId),
              let inspectable = connection.adapter as? SchemaInspectable else {
            throw GridexError.schemaLoadFailed("No inspectable connection")
        }

        let snapshot = try await inspectable.fullSchemaSnapshot(database: connection.config.database)
        await cache.set(connectionId: connectionId, snapshot: snapshot)
        return snapshot
    }

    func invalidateCache(connectionId: UUID) async {
        await cache.invalidate(connectionId: connectionId)
    }
}
