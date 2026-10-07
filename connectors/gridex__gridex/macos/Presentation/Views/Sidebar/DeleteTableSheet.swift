// DeleteTableSheet.swift
// Gridex
//
// Confirmation dialog shown when marking a table for deletion.
// Offers "Ignore foreign key checks" and "Cascade" options.
// The actual DROP is deferred until the user commits from the sidebar header.

import SwiftUI

struct DeleteTableSheet: View {
    let tableName: String
    let onConfirm: (_ cascade: Bool, _ ignoreFK: Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var cascade: Bool = true
    @State private var ignoreFK: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            Text("Delete table '\(tableName)'")
                .font(.system(size: 14, weight: .semibold))
                .padding(.top, 20)
                .padding(.bottom, 16)

            VStack(alignment: .leading, spacing: 10) {
                Toggle(isOn: $ignoreFK) {
                    Text("Ignore foreign key checks")
                        .font(.system(size: 12))
                }
                .toggleStyle(.checkbox)

                Toggle(isOn: $cascade) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Cascade")
                            .font(.system(size: 12))
                        Text("Delete all rows linked by foreign keys")
                            .font(.system(size: 10))
                            .foregroundStyle(.tertiary)
                    }
                }
                .toggleStyle(.checkbox)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 16)

            Divider()

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .pointerCursor()
                Button("OK") {
                    onConfirm(cascade, ignoreFK)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .pointerCursor()
            }
            .padding(16)
        }
        .frame(width: 380)
    }
}
