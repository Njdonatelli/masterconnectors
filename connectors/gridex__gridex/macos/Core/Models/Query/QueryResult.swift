// QueryResult.swift
// Gridex
//
// Result of a database query execution.

import Foundation

struct QueryResult: Sendable {
    let columns: [ColumnHeader]
    let rows: [[RowValue]]
    let rowsAffected: Int
    let executionTime: TimeInterval
    let queryType: QueryType

    var rowCount: Int { rows.count }
    var isEmpty: Bool { rows.isEmpty }
}

struct ColumnHeader: Sendable, Hashable {
    let name: String
    let dataType: String
    let isNullable: Bool
    let tableName: String?

    init(name: String, dataType: String = "unknown", isNullable: Bool = true, tableName: String? = nil) {
        self.name = name
        self.dataType = dataType
        self.isNullable = isNullable
        self.tableName = tableName
    }
}

enum QueryType: String, Sendable {
    case select
    case insert
    case update
    case delete
    case ddl
    case other
}
