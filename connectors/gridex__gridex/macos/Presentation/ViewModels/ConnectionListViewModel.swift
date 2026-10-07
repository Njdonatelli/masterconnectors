// ConnectionListViewModel.swift
// Gridex

import Foundation

@MainActor
final class ConnectionListViewModel: ObservableObject {
    @Published var connections: [ConnectionConfig] = []
    @Published var activeConnectionIds: Set<UUID> = []
    @Published var isLoading = false
    @Published var error: String?

    private let repository: any ConnectionRepository
    private let connectionManager: ConnectionManager
    private let keychainService: KeychainServiceProtocol

    init(
        repository: any ConnectionRepository,
        connectionManager: ConnectionManager,
        keychainService: KeychainServiceProtocol
    ) {
        self.repository = repository
        self.connectionManager = connectionManager
        self.keychainService = keychainService
    }

    func loadConnections() async {
        isLoading = true
        defer { isLoading = false }

        do {
            connections = try await repository.fetchAll()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func connect(config: ConnectionConfig, password: String) async throws {
        let sshPassword: String? = config.sshConfig != nil
            ? (try? keychainService.load(key: "ssh.password.\(config.id.uuidString)")) ?? nil
            : nil
        let _ = try await connectionManager.connect(config: config, password: password, sshPassword: sshPassword)
        activeConnectionIds.insert(config.id)
        try await repository.updateLastConnected(config.id, date: Date())
    }

    func disconnect(connectionId: UUID) async throws {
        try await connectionManager.disconnect(connectionId: connectionId)
        activeConnectionIds.remove(connectionId)
    }

    func saveConnection(_ config: ConnectionConfig, password: String) async throws {
        try await repository.save(config)
        try keychainService.save(key: "db.password.\(config.id.uuidString)", value: password)
        await loadConnections()
    }

    func deleteConnection(_ id: UUID) async throws {
        try await repository.delete(id)
        try keychainService.delete(key: "db.password.\(id.uuidString)")
        await loadConnections()
    }
}
