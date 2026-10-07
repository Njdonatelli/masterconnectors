// AIContextProvider.swift
// Gridex
//
// Protocol for building AI context from database schema.
// Manages token budgeting and smart context selection.

import Foundation

protocol AIContextProvider: Sendable {
    func buildContext(
        for question: String,
        schema: SchemaSnapshot,
        tokenBudget: Int
    ) async throws -> AIContext

    func buildSystemPrompt(
        databaseType: DatabaseType,
        connectionInfo: String,
        context: AIContext
    ) -> String
}
