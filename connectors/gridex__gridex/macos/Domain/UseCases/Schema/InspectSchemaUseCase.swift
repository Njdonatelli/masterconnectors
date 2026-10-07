// InspectSchemaUseCase.swift
// Gridex

import Foundation

protocol InspectSchemaUseCase: Sendable {
    func loadFullSchema(connectionId: UUID) async throws -> SchemaSnapshot
    func refreshSchema(connectionId: UUID) async throws -> SchemaSnapshot
    func describeTable(name: String, schema: String?, connectionId: UUID) async throws -> TableDescription
}
