// WorkspaceRepository.swift
// Gridex

import Foundation

protocol WorkspaceRepository: Sendable {
    func save(state: WorkspaceState) async throws
    func fetch(connectionId: UUID) async throws -> WorkspaceState?
    func update(_ state: WorkspaceState) async throws
    func delete(connectionId: UUID) async throws
}

struct WorkspaceState: Sendable {
    let id: UUID
    let connectionId: UUID
    var openTabs: [TabState]
    var activeTabIndex: Int
    var sidebarWidth: Double
    var aiPanelVisible: Bool
    var aiPanelWidth: Double
    var lastOpenedAt: Date
}

struct TabState: Codable, Sendable {
    let id: UUID
    let type: TabType
    let title: String
    let tableName: String?
    let schema: String?
    let query: String?

    enum TabType: String, Codable, Sendable {
        case dataGrid
        case queryEditor
        case tableStructure
        case tableList
        case functionDetail
        case createTable
        case erDiagram
        // Redis-specific
        case redisKeyDetail
        case redisServerInfo
        case redisSlowLog
    }
}
