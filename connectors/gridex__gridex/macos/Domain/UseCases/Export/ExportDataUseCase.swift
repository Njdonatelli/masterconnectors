// ExportDataUseCase.swift
// Gridex

import Foundation

protocol ExportDataUseCase: Sendable {
    func exportCSV(data: QueryResult, to url: URL) async throws
    func exportJSON(data: QueryResult, to url: URL) async throws
    func exportSQL(data: QueryResult, table: String, to url: URL) async throws
    func exportExcel(data: QueryResult, to url: URL) async throws
    func exportSchemaDDL(schema: SchemaSnapshot, to url: URL) async throws
}
