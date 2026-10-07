#pragma once

#include "DetailsPanel.g.h"
#include "Models/QueryResult.h"
#include "Models/AiService.h"
#include <vector>
#include <string>
#include <thread>

namespace winrt::Gridex::implementation
{
    struct DetailsPanel : DetailsPanelT<DetailsPanel>
    {
        DetailsPanel();

        // Show field values for the selected row
        void ShowRow(
            const std::vector<std::wstring>& columnNames,
            const DBModels::TableRow&        row);

        void ClearRow();

        void DetailsTab_Click(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e);
        void AssistantTab_Click(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e);
        void FieldSearch_TextChanged(
            winrt::Microsoft::UI::Xaml::Controls::AutoSuggestBox const& sender,
            winrt::Microsoft::UI::Xaml::Controls::AutoSuggestBoxTextChangedEventArgs const& e);

        // Set AI config and schema context
        void SetAiConfig(const DBModels::AiConfig& config) { aiService_.SetConfig(config); }
        void SetSchemaContext(const std::wstring& schema) { schemaContext_ = schema; }

        // Put the details pane in read-only mode. Field values render as
        // selectable TextBlocks instead of TextBoxes, no edit handlers
        // attached. Used for Redis connections where inline edits cannot
        // map to safe Redis commands.
        void SetReadOnly(bool ro) { readOnly_ = ro; }

        // Callback when a field value is edited (columnName, oldValue, newValue)
        std::function<void(const std::wstring&, const std::wstring&, const std::wstring&)> OnFieldEdited;

        // Callback: host executes SQL from AI suggestion
        std::function<DBModels::QueryResult(const std::wstring& sql)> OnExecuteQuery;

        // Callback: host returns list of tables in the current DB/schema.
        // Used to populate the "+" context picker flyout in the chat input.
        std::function<std::vector<std::wstring>()> OnRequestTableList;

        // Callback: host returns a formatted structure/DDL snippet for the
        // given table name. The result is concatenated into the chat
        // system prompt so the AI knows the schema of the tables the user
        // added as context via the "+" button.
        std::function<std::wstring(const std::wstring& tableName)> OnFetchTableStructure;

    private:
        // Details panel state
        std::vector<std::wstring> currentColumns_;
        DBModels::TableRow currentRow_;
        void RebuildFields(
            const std::vector<std::wstring>& columnNames,
            const DBModels::TableRow&        row);
        void AddField(
            winrt::Microsoft::UI::Xaml::Controls::StackPanel const& container,
            const std::wstring& label,
            const std::wstring& value);

        bool readOnly_ = false;

        // Chat state
        DBModels::AiService aiService_;
        std::vector<DBModels::ChatMessage> chatHistory_;
        std::wstring schemaContext_;

        // Tables the user picked via "+" to include as context. Kept in
        // insertion order and deduplicated.
        std::vector<std::wstring> selectedContextTables_;

        void SendChatMessage(const std::wstring& text);
        void AddChatBubble(const std::wstring& role, const std::wstring& content);

        // Context picker + chip rendering
        void OpenTablePickerFlyout();
        void AddContextTable(const std::wstring& tableName);
        void RemoveContextTable(const std::wstring& tableName);
        void RebuildContextChips();
        std::wstring BuildSelectedTablesContext() const;
    };
}

namespace winrt::Gridex::factory_implementation
{
    struct DetailsPanel : DetailsPanelT<DetailsPanel, implementation::DetailsPanel>
    {
    };
}
