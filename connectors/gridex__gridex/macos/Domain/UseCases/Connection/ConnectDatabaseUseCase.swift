// ConnectDatabaseUseCase.swift
// Gridex
//
// Orchestrates the full connection flow:
// 1. Resolve SSH tunnel if needed
// 2. Create appropriate adapter
// 3. Establish connection
// 4. Load initial schema

import Foundation

protocol ConnectDatabaseUseCase: Sendable {
    func execute(config: ConnectionConfig, password: String?, sshPassword: String?) async throws -> ActiveConnection
}

struct ActiveConnection: Sendable {
    let id: UUID
    let config: ConnectionConfig
    let adapter: any DatabaseAdapter
    let initialSchema: SchemaSnapshot?
    let connectedAt: Date
}
