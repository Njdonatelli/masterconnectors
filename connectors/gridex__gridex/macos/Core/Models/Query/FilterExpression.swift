// FilterExpression.swift
// Gridex
//
// Filter expressions for data grid filtering.

import Foundation

struct FilterExpression: Sendable {
    let conditions: [FilterCondition]
    let combinator: FilterCombinator

    func toSQL(dialect: SQLDialect) -> String {
        let clauses = conditions.map { $0.toSQL(dialect: dialect) }
        let separator = combinator == .and ? " AND " : " OR "
        return clauses.joined(separator: separator)
    }
}

struct FilterCondition: Sendable {
    let column: String
    let op: FilterOperator
    let value: RowValue

    func toSQL(dialect: SQLDialect) -> String {
        let quotedColumn = dialect.quoteIdentifier(column)
        let escapedValue = escapeValue(value)
        switch op {
        case .equal: return "\(quotedColumn) = \(escapedValue)"
        case .notEqual: return "\(quotedColumn) != \(escapedValue)"
        case .greaterThan: return "\(quotedColumn) > \(escapedValue)"
        case .lessThan: return "\(quotedColumn) < \(escapedValue)"
        case .greaterOrEqual: return "\(quotedColumn) >= \(escapedValue)"
        case .lessOrEqual: return "\(quotedColumn) <= \(escapedValue)"
        case .like: return "\(quotedColumn) LIKE \(escapedValue)"
        case .notLike: return "\(quotedColumn) NOT LIKE \(escapedValue)"
        case .isNull: return "\(quotedColumn) IS NULL"
        case .isNotNull: return "\(quotedColumn) IS NOT NULL"
        case .in_: return "\(quotedColumn) IN (\(escapedValue))"
        }
    }

    private func escapeValue(_ value: RowValue) -> String {
        switch value {
        case .null: return "NULL"
        case .string(let v):
            // Try to detect numeric values and pass them unquoted
            if let _ = Int(v) { return v }
            if let _ = Double(v) { return v }
            return "'\(v.replacingOccurrences(of: "'", with: "''"))'"
        case .integer(let v): return "\(v)"
        case .double(let v): return "\(v)"
        case .boolean(let v): return v ? "TRUE" : "FALSE"
        case .date(let v):
            let fmt = DateFormatter()
            fmt.dateFormat = "yyyy-MM-dd HH:mm:ss"
            fmt.timeZone = TimeZone(identifier: "UTC")
            return "'\(fmt.string(from: v))'"
        case .uuid(let v): return "'\(v.uuidString)'"
        case .json(let v): return "'\(v.replacingOccurrences(of: "'", with: "''"))'"
        case .data: return "NULL"
        case .array: return "NULL"
        }
    }
}

enum FilterOperator: String, CaseIterable, Sendable {
    case equal = "="
    case notEqual = "!="
    case greaterThan = ">"
    case lessThan = "<"
    case greaterOrEqual = ">="
    case lessOrEqual = "<="
    case like = "LIKE"
    case notLike = "NOT LIKE"
    case isNull = "IS NULL"
    case isNotNull = "IS NOT NULL"
    case in_ = "IN"
}

enum FilterCombinator: String, Sendable {
    case and = "AND"
    case or = "OR"
}
