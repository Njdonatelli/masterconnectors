// ChangeTracker.swift
// Gridex
//
// Tracks inline edits in the data grid before committing.

import Foundation

protocol ChangeTracker: AnyObject, Sendable {
    var pendingChanges: [CellEdit] { get }
    var hasChanges: Bool { get }

    func trackEdit(row: Int, column: String, oldValue: RowValue, newValue: RowValue, primaryKey: RowDictionary?)
    func trackInsert(values: RowDictionary)
    func trackDelete(row: Int, primaryKey: RowDictionary)
    func removeInserts()
    func discardChange(at index: Int)
    func discardAll()
    func generateSQL(table: String, schema: String?, dialect: SQLDialect) -> [(sql: String, parameters: [RowValue])]
}

struct CellEdit: Sendable, Identifiable {
    let id: UUID
    let editType: EditType
    let row: Int
    let column: String?
    let oldValue: RowValue?
    let newValue: RowValue?
    let primaryKey: RowDictionary?
    let timestamp: Date

    enum EditType: Sendable {
        case update
        case insert
        case delete
    }

    init(id: UUID = UUID(), editType: EditType, row: Int, column: String? = nil, oldValue: RowValue? = nil, newValue: RowValue? = nil, primaryKey: RowDictionary? = nil) {
        self.id = id
        self.editType = editType
        self.row = row
        self.column = column
        self.oldValue = oldValue
        self.newValue = newValue
        self.primaryKey = primaryKey
        self.timestamp = Date()
    }
}
