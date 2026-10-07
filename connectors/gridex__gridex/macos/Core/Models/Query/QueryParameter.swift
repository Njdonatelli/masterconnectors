// QueryParameter.swift
// Gridex

import Foundation

struct QueryParameter: Sendable {
    let value: RowValue
    let type: String?

    init(_ value: RowValue, type: String? = nil) {
        self.value = value
        self.type = type
    }
}
