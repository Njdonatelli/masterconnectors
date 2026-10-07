// AIModels.swift
// Gridex
//
// Models for AI chat and LLM integration.

import Foundation

struct LLMMessage: Codable, Sendable {
    let role: MessageRole
    let content: String

    enum MessageRole: String, Codable, Sendable {
        case user
        case assistant
        case system
    }
}

struct LLMModel: Sendable, Identifiable {
    let id: String
    let name: String
    let provider: String
    let contextWindow: Int
    let supportsStreaming: Bool
}

struct AIContext: Sendable {
    let relevantTables: [TableDescription]
    let schemaSQL: String
    let sampleData: [String: [[RowValue]]]
    let statistics: [String: [ColumnStatistics]]
    let tokenCount: Int
}

struct ChatMessage: Codable, Sendable, Identifiable {
    let id: UUID
    let role: LLMMessage.MessageRole
    let content: String
    let timestamp: Date
    let sqlBlocks: [SQLBlock]?
    let queryResults: [InlinedQueryResult]?

    init(id: UUID = UUID(), role: LLMMessage.MessageRole, content: String, timestamp: Date = Date(), sqlBlocks: [SQLBlock]? = nil, queryResults: [InlinedQueryResult]? = nil) {
        self.id = id
        self.role = role
        self.content = content
        self.timestamp = timestamp
        self.sqlBlocks = sqlBlocks
        self.queryResults = queryResults
    }
}

struct SQLBlock: Codable, Sendable, Identifiable {
    let id: UUID
    let sql: String
    var wasExecuted: Bool
    var executionResult: InlinedQueryResult?

    init(id: UUID = UUID(), sql: String, wasExecuted: Bool = false, executionResult: InlinedQueryResult? = nil) {
        self.id = id
        self.sql = sql
        self.wasExecuted = wasExecuted
        self.executionResult = executionResult
    }
}

struct InlinedQueryResult: Codable, Sendable {
    let columnNames: [String]
    let rows: [[String]]
    let rowCount: Int
    let executionTime: TimeInterval
    let error: String?
}
