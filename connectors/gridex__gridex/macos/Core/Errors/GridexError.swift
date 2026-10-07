// GridexError.swift
// Gridex
//
// Centralized error types for the entire application.

import Foundation

enum GridexError: LocalizedError, Sendable, Equatable {
    static func == (lhs: GridexError, rhs: GridexError) -> Bool {
        lhs.errorDescription == rhs.errorDescription
    }

    // Connection
    case connectionFailed(underlying: any Error & Sendable)
    case connectionTimeout
    case authenticationFailed
    case sslRequired
    case databaseNotFound(String)

    // Query
    case queryExecutionFailed(String)
    case queryCancelled
    case queryTimeout
    case invalidSQL(String)

    // SSH
    case sshConnectionFailed(underlying: any Error & Sendable)
    case sshAuthenticationFailed
    case sshTunnelFailed

    // Schema
    case schemaLoadFailed(String)
    case tableNotFound(String)

    // AI
    case aiProviderError(String)
    case aiAPIKeyMissing
    case aiTokenLimitExceeded
    case aiStreamingError(String)

    // Data
    case keychainError(String)
    case persistenceError(String)
    case importError(String)
    case exportError(String)

    // General
    case unsupportedOperation(String)
    case internalError(String)

    var errorDescription: String? {
        switch self {
        case .connectionFailed(let error): return "Connection failed: \(error.localizedDescription)"
        case .connectionTimeout: return "Connection timed out"
        case .authenticationFailed: return "Authentication failed. Check your credentials."
        case .sslRequired: return "SSL connection is required by the server"
        case .databaseNotFound(let name): return "Database '\(name)' not found"
        case .queryExecutionFailed(let msg): return "Query failed: \(msg)"
        case .queryCancelled: return "Query was cancelled"
        case .queryTimeout: return "Query timed out"
        case .invalidSQL(let msg): return "Invalid SQL: \(msg)"
        case .sshConnectionFailed(let error): return "SSH connection failed: \(error.localizedDescription)"
        case .sshAuthenticationFailed: return "SSH authentication failed"
        case .sshTunnelFailed: return "SSH tunnel could not be established"
        case .schemaLoadFailed(let msg): return "Failed to load schema: \(msg)"
        case .tableNotFound(let name): return "Table '\(name)' not found"
        case .aiProviderError(let msg): return "AI provider error: \(msg)"
        case .aiAPIKeyMissing: return "AI API key is not configured"
        case .aiTokenLimitExceeded: return "Token limit exceeded for AI context"
        case .aiStreamingError(let msg): return "AI streaming error: \(msg)"
        case .keychainError(let msg): return "Keychain error: \(msg)"
        case .persistenceError(let msg): return "Data persistence error: \(msg)"
        case .importError(let msg): return "Import error: \(msg)"
        case .exportError(let msg): return "Export error: \(msg)"
        case .unsupportedOperation(let msg): return "Unsupported operation: \(msg)"
        case .internalError(let msg): return "Internal error: \(msg)"
        }
    }
}
