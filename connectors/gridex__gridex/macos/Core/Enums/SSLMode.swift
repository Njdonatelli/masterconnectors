// SSLMode.swift
// Gridex

import Foundation

enum SSLMode: String, Codable, Sendable, CaseIterable {
    case preferred = "PREFERRED"
    case disabled = "DISABLED"
    case required = "REQUIRED"
    case verifyCA = "VERIFY_CA"
    case verifyIdentity = "VERIFY_IDENTITY"

    var displayName: String {
        switch self {
        case .preferred: return "PREFERRED"
        case .disabled: return "DISABLED"
        case .required: return "REQUIRED"
        case .verifyCA: return "VERIFY CA"
        case .verifyIdentity: return "VERIFY IDENTITY"
        }
    }
}
