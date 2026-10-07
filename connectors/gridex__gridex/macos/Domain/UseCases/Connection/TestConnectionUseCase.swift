// TestConnectionUseCase.swift
// Gridex

import Foundation

protocol TestConnectionUseCase: Sendable {
    func execute(config: ConnectionConfig, password: String?, sshPassword: String?) async throws -> ConnectionTestResult
}

struct ConnectionTestResult: Sendable {
    let success: Bool
    let serverVersion: String?
    let latency: TimeInterval
    let errorMessage: String?
}
