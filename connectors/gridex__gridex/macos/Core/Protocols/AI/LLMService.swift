// LLMService.swift
// Gridex
//
// Protocol for LLM provider integration.
// Supports streaming responses from Anthropic, OpenAI, and Ollama.

import Foundation

protocol LLMService: Sendable {
    var providerName: String { get }

    func stream(
        messages: [LLMMessage],
        systemPrompt: String,
        model: String,
        maxTokens: Int,
        temperature: Double
    ) -> AsyncThrowingStream<String, Error>

    func availableModels() async throws -> [LLMModel]
    func validateAPIKey() async throws -> Bool
}
