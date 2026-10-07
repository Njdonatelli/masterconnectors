// QueryBuilder.swift
// Gridex
//
// Fluent SQL query builder with dialect support.

import Foundation

struct QueryBuilder {
    private let dialect: SQLDialect
    private var selectColumns: [String] = ["*"]
    private var fromTable: String = ""
    private var fromSchema: String?
    private var whereClauses: [String] = []
    private var orderByClauses: [String] = []
    private var limitValue: Int?
    private var offsetValue: Int?
    private var joinClauses: [String] = []

    init(dialect: SQLDialect) {
        self.dialect = dialect
    }

    func select(_ columns: [String]) -> QueryBuilder {
        var copy = self
        copy.selectColumns = columns.map { dialect.quoteIdentifier($0) }
        return copy
    }

    func selectAll() -> QueryBuilder {
        var copy = self
        copy.selectColumns = ["*"]
        return copy
    }

    func from(_ table: String, schema: String? = nil) -> QueryBuilder {
        var copy = self
        copy.fromTable = table
        copy.fromSchema = schema
        return copy
    }

    func whereClause(_ condition: String) -> QueryBuilder {
        var copy = self
        copy.whereClauses.append(condition)
        return copy
    }

    func whereFilter(_ filter: FilterExpression) -> QueryBuilder {
        var copy = self
        copy.whereClauses.append(filter.toSQL(dialect: dialect))
        return copy
    }

    func orderBy(_ column: String, _ direction: SortDirection = .ascending) -> QueryBuilder {
        var copy = self
        copy.orderByClauses.append("\(dialect.quoteIdentifier(column)) \(direction.rawValue)")
        return copy
    }

    func orderBy(_ descriptors: [QuerySortDescriptor]) -> QueryBuilder {
        var copy = self
        copy.orderByClauses = descriptors.map { $0.toSQL(dialect: dialect) }
        return copy
    }

    func limit(_ n: Int) -> QueryBuilder {
        var copy = self
        copy.limitValue = n
        return copy
    }

    func offset(_ n: Int) -> QueryBuilder {
        var copy = self
        copy.offsetValue = n
        return copy
    }

    func build() -> String {
        var sql = "SELECT \(selectColumns.joined(separator: ", "))"

        let tableRef: String
        if let schema = fromSchema {
            tableRef = "\(dialect.quoteIdentifier(schema)).\(dialect.quoteIdentifier(fromTable))"
        } else {
            tableRef = dialect.quoteIdentifier(fromTable)
        }
        sql += " FROM \(tableRef)"

        for join in joinClauses {
            sql += " \(join)"
        }

        if !whereClauses.isEmpty {
            sql += " WHERE " + whereClauses.joined(separator: " AND ")
        }

        if !orderByClauses.isEmpty {
            sql += " ORDER BY " + orderByClauses.joined(separator: ", ")
        }

        if let limit = limitValue {
            sql += " LIMIT \(limit)"
        }

        if let offset = offsetValue, offset > 0 {
            sql += " OFFSET \(offset)"
        }

        return sql
    }

    // MARK: - Count query

    func buildCount() -> String {
        var sql = "SELECT COUNT(*)"
        let tableRef: String
        if let schema = fromSchema {
            tableRef = "\(dialect.quoteIdentifier(schema)).\(dialect.quoteIdentifier(fromTable))"
        } else {
            tableRef = dialect.quoteIdentifier(fromTable)
        }
        sql += " FROM \(tableRef)"

        if !whereClauses.isEmpty {
            sql += " WHERE " + whereClauses.joined(separator: " AND ")
        }

        return sql
    }
}
