// AIContextEngine.swift
// Gridex
//
// Builds optimized context from database schema for LLM queries.
// Handles token budgeting and smart table selection.

import Foundation

final class AIContextEngine: AIContextProvider, @unchecked Sendable {
    private let schemaCache: SchemaCache

    init(schemaCache: SchemaCache) {
        self.schemaCache = schemaCache
    }

    func buildContext(
        for question: String,
        schema: SchemaSnapshot,
        tokenBudget: Int
    ) async throws -> AIContext {
        let relevantTables = selectRelevantTables(question: question, schema: schema)
        let ddl = relevantTables.map { $0.toDDL(dialect: schema.databaseType.sqlDialect) }.joined(separator: "\n\n")
        let estimatedTokens = estimateTokenCount(ddl)

        return AIContext(
            relevantTables: relevantTables,
            schemaSQL: ddl,
            sampleData: [:],
            statistics: [:],
            tokenCount: estimatedTokens
        )
    }

    func buildSystemPrompt(
        databaseType: DatabaseType,
        connectionInfo: String,
        context: AIContext
    ) -> String {
        """
        You are a database expert assistant. You have access to the following schema:

        \(context.schemaSQL)

        Current connection: \(connectionInfo)
        Database type: \(databaseType.displayName)

        Rules:
        - Generate SQL that is valid for \(databaseType.displayName)
        - Always use parameterized queries for user input
        - Explain your reasoning
        - When suggesting changes, show the SQL and explain risks
        - If asked to execute, wait for user confirmation
        - Format SQL blocks with ```sql markers
        """
    }

    private func selectRelevantTables(question: String, schema: SchemaSnapshot) -> [TableDescription] {
        let keywords = question.lowercased().split(separator: " ").map(String.init)
        let allTables = schema.allTables

        // Score tables by keyword relevance
        let scored = allTables.map { table -> (TableDescription, Int) in
            var score = 0
            let tableName = table.name.lowercased()

            for keyword in keywords {
                if tableName.contains(keyword) { score += 10 }
                for column in table.columns {
                    if column.name.lowercased().contains(keyword) { score += 5 }
                }
            }

            // Include tables related via foreign keys
            for fk in table.foreignKeys {
                if keywords.contains(where: { fk.referencedTable.lowercased().contains($0) }) {
                    score += 3
                }
            }

            return (table, score)
        }

        let relevant = scored.filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }.map(\.0)

        // If no keyword match, return all tables (up to limit)
        if relevant.isEmpty {
            return Array(allTables.prefix(20))
        }

        return Array(relevant.prefix(15))
    }

    private func estimateTokenCount(_ text: String) -> Int {
        // Rough estimation: ~4 characters per token
        text.count / 4
    }
}
