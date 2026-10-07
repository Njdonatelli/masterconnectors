// DefaultChangeTracker.swift
// Gridex
//
// Concrete implementation of ChangeTracker.
// Tracks cell edits, inserts, and deletes; generates commit SQL.

import Foundation

final class DefaultChangeTracker: ChangeTracker, @unchecked Sendable {
    private let lock = NSLock()
    private var _changes: [CellEdit] = []

    var pendingChanges: [CellEdit] {
        lock.lock()
        defer { lock.unlock() }
        return _changes
    }

    var hasChanges: Bool {
        lock.lock()
        defer { lock.unlock() }
        return !_changes.isEmpty
    }

    func trackEdit(row: Int, column: String, oldValue: RowValue, newValue: RowValue, primaryKey: RowDictionary? = nil) {
        guard oldValue != newValue else { return }
        lock.lock()
        defer { lock.unlock() }

        // If there's already an edit for the same row+column, update it
        if let idx = _changes.firstIndex(where: { $0.row == row && $0.column == column && $0.editType == .update }) {
            let existing = _changes[idx]
            // If reverting to original, remove the change
            if existing.oldValue == newValue {
                _changes.remove(at: idx)
                return
            }
            _changes[idx] = CellEdit(editType: .update, row: row, column: column, oldValue: existing.oldValue, newValue: newValue, primaryKey: existing.primaryKey ?? primaryKey)
        } else {
            _changes.append(CellEdit(editType: .update, row: row, column: column, oldValue: oldValue, newValue: newValue, primaryKey: primaryKey))
        }
    }

    func trackInsert(values: RowDictionary) {
        lock.lock()
        defer { lock.unlock() }
        _changes.append(CellEdit(editType: .insert, row: -1, newValue: nil, primaryKey: values))
    }

    func trackDelete(row: Int, primaryKey: RowDictionary) {
        lock.lock()
        defer { lock.unlock() }

        // Remove any pending edits for this row
        _changes.removeAll { $0.row == row && $0.editType == .update }
        _changes.append(CellEdit(editType: .delete, row: row, primaryKey: primaryKey))
    }

    func removeInserts() {
        lock.lock()
        defer { lock.unlock() }
        _changes.removeAll { $0.editType == .insert }
    }

    func discardChange(at index: Int) {
        lock.lock()
        defer { lock.unlock() }
        guard _changes.indices.contains(index) else { return }
        _changes.remove(at: index)
    }

    func discardAll() {
        lock.lock()
        defer { lock.unlock() }
        _changes.removeAll()
    }

    func generateSQL(table: String, schema: String?, dialect: SQLDialect) -> [(sql: String, parameters: [RowValue])] {
        lock.lock()
        let changes = _changes
        lock.unlock()

        let qt: String
        if let schema, !schema.isEmpty {
            qt = "\(dialect.quoteIdentifier(schema)).\(dialect.quoteIdentifier(table))"
        } else {
            qt = dialect.quoteIdentifier(table)
        }
        var statements: [(sql: String, parameters: [RowValue])] = []

        for edit in changes {
            switch edit.editType {
            case .update:
                guard let column = edit.column, let newValue = edit.newValue, let pk = edit.primaryKey else { continue }
                var params: [RowValue] = []
                var paramIndex = 1
                let setClause = "\(dialect.quoteIdentifier(column)) = \(placeholder(dialect: dialect, index: &paramIndex))"
                params.append(newValue)
                let whereClause = pk.map { key, value -> String in
                    whereCondition(key, value, dialect: dialect, params: &params, paramIndex: &paramIndex)
                }.joined(separator: " AND ")
                statements.append((sql: "UPDATE \(qt) SET \(setClause) WHERE \(whereClause);", parameters: params))

            case .insert:
                guard let pk = edit.primaryKey else { continue }
                var params: [RowValue] = []
                var paramIndex = 1
                let entries = Array(pk)
                let cols = entries.map { dialect.quoteIdentifier($0.key) }.joined(separator: ", ")
                let placeholders = entries.map { entry -> String in
                    params.append(entry.value)
                    return placeholder(dialect: dialect, index: &paramIndex)
                }.joined(separator: ", ")
                statements.append((sql: "INSERT INTO \(qt) (\(cols)) VALUES (\(placeholders));", parameters: params))

            case .delete:
                guard let pk = edit.primaryKey else { continue }
                var params: [RowValue] = []
                var paramIndex = 1
                let whereClause = pk.map { key, value -> String in
                    whereCondition(key, value, dialect: dialect, params: &params, paramIndex: &paramIndex)
                }.joined(separator: " AND ")
                statements.append((sql: "DELETE FROM \(qt) WHERE \(whereClause);", parameters: params))
            }
        }

        return statements
    }

    private func placeholder(dialect: SQLDialect, index: inout Int) -> String {
        let p = dialect.parameterPlaceholder(index)
        index += 1
        return p
    }

    private func whereCondition(_ key: String, _ value: RowValue, dialect: SQLDialect, params: inout [RowValue], paramIndex: inout Int) -> String {
        if case .null = value {
            return "\(dialect.quoteIdentifier(key)) IS NULL"
        }
        let p = placeholder(dialect: dialect, index: &paramIndex)
        params.append(value)
        return "\(dialect.quoteIdentifier(key)) = \(p)"
    }
}
