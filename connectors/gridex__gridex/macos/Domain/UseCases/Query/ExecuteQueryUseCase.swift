// ExecuteQueryUseCase.swift
// Gridex

import Foundation

protocol ExecuteQueryUseCase: Sendable {
    func execute(sql: String, connectionId: UUID, parameters: [QueryParameter]?) async throws -> QueryResult
    func cancel() async
}
