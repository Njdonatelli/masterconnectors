// ConnectionRepository.swift
// Gridex
//
// Repository protocol for managing saved connections.

import Foundation

protocol ConnectionRepository: Sendable {
    func fetchAll() async throws -> [ConnectionConfig]
    func fetchByID(_ id: UUID) async throws -> ConnectionConfig?
    func fetchByGroup(_ group: String) async throws -> [ConnectionConfig]
    func save(_ config: ConnectionConfig) async throws
    func update(_ config: ConnectionConfig) async throws
    func delete(_ id: UUID) async throws
    func updateLastConnected(_ id: UUID, date: Date) async throws
    func reorder(ids: [UUID]) async throws
}
