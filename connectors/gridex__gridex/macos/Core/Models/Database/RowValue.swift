// RowValue.swift
// Gridex
//
// Unified value type for all database cell values.
// Abstracts away database-specific types into a common representation.

import Foundation

private let _sharedDateFormatter: DateFormatter = {
    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd HH:mm:ss"
    fmt.timeZone = TimeZone(identifier: "UTC")
    return fmt
}()

enum RowValue: Codable, Sendable, Hashable, CustomStringConvertible {
    case null
    case string(String)
    case integer(Int64)
    case double(Double)
    case boolean(Bool)
    case date(Date)
    case data(Data)
    case json(String)
    case uuid(UUID)
    case array([RowValue])

    var isNull: Bool {
        if case .null = self { return true }
        return false
    }

    var isNumeric: Bool {
        switch self {
        case .integer, .double: return true
        default: return false
        }
    }

    var stringValue: String? {
        switch self {
        case .null: return nil
        case .string(let v): return v
        case .integer(let v): return String(v)
        case .double(let v): return String(v)
        case .boolean(let v): return v ? "true" : "false"
        case .date(let v):
            return _sharedDateFormatter.string(from: v)
        case .data(let v): return v.base64EncodedString()
        case .json(let v): return v
        case .uuid(let v): return v.uuidString
        case .array(let v): return v.map(\.description).joined(separator: ", ")
        }
    }

    var intValue: Int? {
        switch self {
        case .integer(let v): return Int(v)
        case .double(let v): return Int(v)
        case .string(let v): return Int(v)
        case .boolean(let v): return v ? 1 : 0
        default: return nil
        }
    }

    var doubleValue: Double? {
        switch self {
        case .double(let v): return v
        case .integer(let v): return Double(v)
        case .string(let v): return Double(v)
        default: return nil
        }
    }

    var description: String {
        stringValue ?? "NULL"
    }

    /// Truncated version for display in grid cells. Avoids expensive
    /// full base64 encoding for blobs and caps long strings.
    var displayString: String {
        switch self {
        case .null: return "NULL"
        case .data(let v):
            if v.count > 100 {
                return "(BLOB \(v.count) bytes)"
            }
            return v.base64EncodedString()
        case .json(let v):
            if v.count > 300 { return String(v.prefix(300)) + "…" }
            return v
        case .string(let v):
            if v.count > 500 { return String(v.prefix(500)) + "…" }
            return v
        case .array(let v):
            let joined = v.prefix(20).map(\.description).joined(separator: ", ")
            if v.count > 20 { return joined + "… (\(v.count) items)" }
            return joined
        default: return description
        }
    }
}
