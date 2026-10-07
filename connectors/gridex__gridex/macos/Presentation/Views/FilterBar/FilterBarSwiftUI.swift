// FilterBarSwiftUI.swift
// Gridex
//
// Compact filter bar.

import SwiftUI

struct FilterBarSwiftUIView: View {
    let columns: [ColumnHeader]
    var initialFilter: FilterExpression?
    var onApply: (FilterExpression?) -> Void
    var onClear: () -> Void
    var onDismiss: (() -> Void)?

    @State private var conditions: [FilterUICondition] = [FilterUICondition()]
    @State private var combinator: FilterCombinator = .and
    @State private var didApplyInitial = false

    struct FilterUICondition: Identifiable {
        let id = UUID()
        var isEnabled: Bool = true
        var column: String = ""          // "" = "Any column"
        var op: FilterOperator = .equal
        var value: String = ""
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(conditions.enumerated()), id: \.element.id) { index, _ in
                filterRow(index: index)
                if index < conditions.count - 1 {
                    Divider().padding(.leading, 32)
                }
            }
        }
        .background(Color(nsColor: .controlBackgroundColor))
        .overlay(alignment: .bottom) { Divider() }
        .onAppear {
            guard !didApplyInitial, let filter = initialFilter, !filter.conditions.isEmpty else { return }
            didApplyInitial = true
            combinator = filter.combinator
            conditions = filter.conditions.map { cond in
                var value = ""
                if case .string(let v) = cond.value { value = v }
                return FilterUICondition(isEnabled: true, column: cond.column, op: cond.op, value: value)
            }
        }
    }

    @ViewBuilder
    private func filterRow(index: Int) -> some View {
        HStack(spacing: 6) {
            // Enable/disable checkbox
            Toggle("", isOn: $conditions[index].isEnabled)
                .toggleStyle(.checkbox)
                .labelsHidden()

            // Column picker
            Picker("", selection: $conditions[index].column) {
                Text("Any column").tag("")
                ForEach(columns, id: \.name) { col in
                    Text(col.name).tag(col.name)
                }
            }
            .labelsHidden()
            .frame(width: 130)

            // Operator picker
            Picker("", selection: $conditions[index].op) {
                Text("=").tag(FilterOperator.equal)
                Text("!=").tag(FilterOperator.notEqual)
                Text(">").tag(FilterOperator.greaterThan)
                Text("<").tag(FilterOperator.lessThan)
                Text(">=").tag(FilterOperator.greaterOrEqual)
                Text("<=").tag(FilterOperator.lessOrEqual)
                Text("LIKE").tag(FilterOperator.like)
                Text("NOT LIKE").tag(FilterOperator.notLike)
                Text("IS NULL").tag(FilterOperator.isNull)
                Text("IS NOT NULL").tag(FilterOperator.isNotNull)
            }
            .labelsHidden()
            .frame(width: 80)

            // Value field (hidden for IS NULL / IS NOT NULL)
            if conditions[index].op != .isNull && conditions[index].op != .isNotNull {
                TextField("EMPTY", text: $conditions[index].value)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 12))
                    .onSubmit { applyFilter() }
            } else {
                Spacer()
            }

            // Apply
            Button("Apply") { applyFilter() }
                .controlSize(.small)
                .buttonStyle(.borderedProminent)

            // Remove this row
            Button {
                if conditions.count > 1 {
                    conditions.remove(at: index)
                } else {
                    onClear()
                    onDismiss?()
                }
            } label: {
                Image(systemName: "minus")
                    .font(.system(size: 11, weight: .medium))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .pointerCursor()
            .foregroundStyle(.secondary)

            // Add new row
            Button {
                conditions.insert(FilterUICondition(), at: index + 1)
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .medium))
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .pointerCursor()
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .frame(height: 30)
    }

    private func applyFilter() {
        let enabledConditions = conditions.filter { $0.isEnabled }
        let filterConditions = enabledConditions.compactMap { cond -> FilterCondition? in
            if cond.op == .isNull || cond.op == .isNotNull {
                if cond.column.isEmpty { return nil }
                return FilterCondition(column: cond.column, op: cond.op, value: .null)
            }
            guard !cond.value.isEmpty else { return nil }
            if cond.column.isEmpty { return nil }
            return FilterCondition(column: cond.column, op: cond.op, value: .string(cond.value))
        }
        if filterConditions.isEmpty {
            onApply(nil)
        } else {
            onApply(FilterExpression(conditions: filterConditions, combinator: combinator))
        }
    }
}
