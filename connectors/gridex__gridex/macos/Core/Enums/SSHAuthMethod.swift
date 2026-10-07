// SSHAuthMethod.swift
// Gridex

import Foundation

enum SSHAuthMethod: String, Codable, Sendable {
    case password
    case privateKey
    case keyWithPassphrase
}
