// QueryHistoryEntity.swift
// Gridex

import Foundation
import SwiftData

@Model
final class QueryHistoryEntity {
    @Attribute(.unique) var id: UUID
    var connectionId: UUID
    var database: String
    var sql: String
    var executedAt: Date
    var duration: TimeInterval
    var rowCount: Int?
    var status: String
    var errorMessage: String?
    var isFavorite: Bool

    init(
        id: UUID = UUID(),
        connectionId: UUID,
        database: String,
        sql: String,
        executedAt: Date = Date(),
        duration: TimeInterval,
        rowCount: Int? = nil,
        status: String = "success",
        errorMessage: String? = nil,
        isFavorite: Bool = false
    ) {
        self.id = id
        self.connectionId = connectionId
        self.database = database
        self.sql = sql
        self.executedAt = executedAt
        self.duration = duration
        self.rowCount = rowCount
        self.status = status
        self.errorMessage = errorMessage
        self.isFavorite = isFavorite
    }
}
