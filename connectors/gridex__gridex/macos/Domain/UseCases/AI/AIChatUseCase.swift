// AIChatUseCase.swift
// Gridex

import Foundation

protocol AIChatUseCase: Sendable {
    func sendMessage(
        _ message: String,
        conversation: AIConversation,
        schema: SchemaSnapshot,
        connectionInfo: ConnectionConfig
    ) -> AsyncThrowingStream<String, Error>

    func suggestQuestions(for schema: SchemaSnapshot) async throws -> [String]
}
