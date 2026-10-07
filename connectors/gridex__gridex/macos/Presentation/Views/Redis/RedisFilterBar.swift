// RedisFilterBar.swift
// Gridex
//
// Pattern-based filter bar for Redis keys (replaces SQL filter bar).
// Supports Redis glob patterns: * (any), ? (single char), [abc] (char class).

import SwiftUI

struct RedisFilterBar: View {
    var initialFilter: FilterExpression?
    var onApply: (FilterExpression?) -> Void
    var onClear: () -> Void
    var onDismiss: (() -> Void)?

    @State private var pattern: String = ""
    @State private var didApplyInitial = false

    // Quick-filter presets based on common key naming conventions
    private let presets = ["user:*", "session:*", "cache:*", "config:*", "queue:*"]

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)

            TextField("Filter keys by pattern (e.g. user:* or *session*)", text: $pattern)
                .textFieldStyle(.plain)
                .font(.system(size: 12, design: .monospaced))
                .onSubmit { applyPattern() }

            if !pattern.isEmpty {
                Text("\(pattern.contains("*") || pattern.contains("?") ? "glob" : "exact")")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(Color.secondary.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 2))
            }

            // Quick presets
            Menu {
                ForEach(presets, id: \.self) { preset in
                    Button(preset) {
                        pattern = preset
                        applyPattern()
                    }
                }
                Divider()
                Button("All keys (*)") {
                    pattern = ""
                    onClear()
                }
            } label: {
                Image(systemName: "text.badge.star")
                    .font(.system(size: 11))
            }
            .menuStyle(.borderlessButton)
            .frame(width: 24)
            .help("Quick filter presets")

            Button("Apply") { applyPattern() }
                .controlSize(.small)
                .buttonStyle(.borderedProminent)

            Button {
                pattern = ""
                onClear()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .medium))
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Clear filter")

            Button {
                onDismiss?()
            } label: {
                Image(systemName: "chevron.up")
                    .font(.system(size: 10, weight: .medium))
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Hide filter bar")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .frame(height: 30)
        .background(Color(nsColor: .controlBackgroundColor))
        .overlay(alignment: .bottom) { Divider() }
        .onAppear {
            guard !didApplyInitial, let filter = initialFilter else { return }
            didApplyInitial = true
            // Extract pattern from existing filter
            for cond in filter.conditions where cond.column == "key" {
                if case .like = cond.op, let v = cond.value.stringValue {
                    pattern = v.replacingOccurrences(of: "%", with: "*")
                        .replacingOccurrences(of: "_", with: "?")
                } else if case .equal = cond.op, let v = cond.value.stringValue {
                    pattern = v
                }
            }
        }
    }

    private func applyPattern() {
        let trimmed = pattern.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            onClear()
            return
        }

        // Convert glob pattern to LIKE for FilterExpression transport
        // RedisAdapter.extractPattern() converts it back to glob for SCAN
        let likePattern = trimmed
            .replacingOccurrences(of: "*", with: "%")
            .replacingOccurrences(of: "?", with: "_")

        let condition = FilterCondition(
            column: "key",
            op: trimmed.contains("*") || trimmed.contains("?") ? .like : .equal,
            value: .string(likePattern)
        )
        onApply(FilterExpression(conditions: [condition], combinator: .and))
    }
}
