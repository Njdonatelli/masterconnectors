// AIConversationRepository.swift
// Gridex

import Foundation

protocol AIConversationRepository: Sendable {
    func save(conversation: AIConversation) async throws
    func fetch(connectionId: UUID) async throws -> [AIConversation]
    func fetchByID(_ id: UUID) async throws -> AIConversation?
    func update(_ conversation: AIConversation) async throws
    func delete(_ id: UUID) async throws
}

struct AIConversation: Sendable, Identifiable {
    let id: UUID
    let connectionId: UUID
    var messages: [ChatMessage]
    let createdAt: Date
    var updatedAt: Date
}
