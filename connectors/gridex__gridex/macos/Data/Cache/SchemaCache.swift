// SchemaCache.swift
// Gridex
//
// In-memory cache for database schemas with TTL.

import Foundation

actor SchemaCache {
    private var cache: [UUID: CachedSchema] = [:]
    private let defaultTTL: TimeInterval = 300 // 5 minutes

    struct CachedSchema {
        let snapshot: SchemaSnapshot
        let cachedAt: Date
        let ttl: TimeInterval

        var isExpired: Bool {
            Date().timeIntervalSince(cachedAt) > ttl
        }
    }

    func get(connectionId: UUID) -> SchemaSnapshot? {
        guard let cached = cache[connectionId], !cached.isExpired else {
            cache[connectionId] = nil
            return nil
        }
        return cached.snapshot
    }

    func set(connectionId: UUID, snapshot: SchemaSnapshot, ttl: TimeInterval? = nil) {
        cache[connectionId] = CachedSchema(
            snapshot: snapshot,
            cachedAt: Date(),
            ttl: ttl ?? defaultTTL
        )
    }

    func invalidate(connectionId: UUID) {
        cache[connectionId] = nil
    }

    func invalidateAll() {
        cache.removeAll()
    }
}
