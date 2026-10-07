// AIChatViewModel.swift
// Gridex

import Foundation

@MainActor
final class AIChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var isStreaming: Bool = false
    @Published var suggestedQuestions: [String] = []
    @Published var errorMessage: String?

    private let chatUseCase: any AIChatUseCase
    private let queryEngine: QueryEngine
    private var currentStreamTask: Task<Void, Never>?
    private var connectionId: UUID
    private var schema: SchemaSnapshot?
    private var connectionConfig: ConnectionConfig?

    init(chatUseCase: any AIChatUseCase, queryEngine: QueryEngine, connectionId: UUID) {
        self.chatUseCase = chatUseCase
        self.queryEngine = queryEngine
        self.connectionId = connectionId
    }

    deinit {
        currentStreamTask?.cancel()
    }

    func configure(schema: SchemaSnapshot, config: ConnectionConfig) {
        self.schema = schema
        self.connectionConfig = config
    }

    func sendMessage(_ text: String) {
        guard let schema, let config = connectionConfig else { return }

        let userMessage = ChatMessage(role: .user, content: text)
        messages.append(userMessage)

        let conversation = AIConversation(
            id: UUID(),
            connectionId: connectionId,
            messages: messages,
            createdAt: Date(),
            updatedAt: Date()
        )

        isStreaming = true

        currentStreamTask = Task { [weak self] in
            guard let self else { return }
            var assistantContent = ""
            do {
                let stream = chatUseCase.sendMessage(text, conversation: conversation, schema: schema, connectionInfo: config)
                for try await token in stream {
                    assistantContent += token
                    // Update last message in real-time
                    if self.messages.last?.role == .assistant {
                        self.messages[self.messages.count - 1] = ChatMessage(role: .assistant, content: assistantContent)
                    } else {
                        self.messages.append(ChatMessage(role: .assistant, content: assistantContent))
                    }
                }
            } catch {
                self.errorMessage = error.localizedDescription
                self.messages.append(ChatMessage(role: .assistant, content: "Error: \(error.localizedDescription)"))
            }
            self.isStreaming = false
        }
    }

    func stopStreaming() {
        currentStreamTask?.cancel()
        currentStreamTask = nil
        isStreaming = false
    }

    func dismissError() {
        errorMessage = nil
    }

    func clearChat() {
        messages.removeAll()
    }

    func executeSQL(_ sql: String) async {
        do {
            let result = try await queryEngine.execute(sql: sql, connectionId: connectionId)
            let resultMessage = "Query executed successfully. \(result.rowCount) rows returned in \(Int(result.executionTime * 1000))ms."
            messages.append(ChatMessage(role: .assistant, content: resultMessage))
        } catch {
            messages.append(ChatMessage(role: .assistant, content: "Query error: \(error.localizedDescription)"))
        }
    }
}
