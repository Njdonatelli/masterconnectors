// SchemaInspectable.swift
// Gridex
//
// Protocol for inspecting database schema in detail.
// Used by AI Context Engine to build schema snapshots.

import Foundation

protocol SchemaInspectable: Sendable {
    func fullSchemaSnapshot(database: String?) async throws -> SchemaSnapshot
    func columnStatistics(table: String, schema: String?, sampleSize: Int) async throws -> [ColumnStatistics]
    func tableRowCount(table: String, schema: String?) async throws -> Int
    func tableSizeBytes(table: String, schema: String?) async throws -> Int64?
    func queryStatistics() async throws -> [QueryStatisticsEntry]
    func primaryKeyColumns(table: String, schema: String?) async throws -> [String]
}
