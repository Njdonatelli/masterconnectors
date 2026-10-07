// SortDescriptor.swift
// Gridex

import Foundation

struct QuerySortDescriptor: Sendable, Hashable {
    let column: String
    let direction: SortDirection

    func toSQL(dialect: SQLDialect) -> String {
        "\(dialect.quoteIdentifier(column)) \(direction.rawValue)"
    }
}

enum SortDirection: String, Sendable {
    case ascending = "ASC"
    case descending = "DESC"

    mutating func toggle() {
        self = self == .ascending ? .descending : .ascending
    }
}
