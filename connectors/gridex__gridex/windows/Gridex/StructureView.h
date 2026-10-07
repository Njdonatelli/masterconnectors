#pragma once

#include "StructureView.g.h"
#include "Models/ColumnInfo.h"
#include "Models/DatabaseType.h"
#include <vector>
#include <functional>

namespace winrt::Gridex::implementation
{
    // Pending ALTER operations
    struct AlterOp
    {
        enum Type { AddColumn, DropColumn, AlterType, AlterNullable, AlterDefault, RenameColumn };
        Type type;
        std::wstring column;
        std::wstring oldValue;
        std::wstring newValue;
    };

    struct StructureView : StructureViewT<StructureView>
    {
        StructureView();

        void SetData(
            const std::vector<DBModels::ColumnInfo>&    columns,
            const std::vector<DBModels::IndexInfo>&     indexes,
            const std::vector<DBModels::ForeignKeyInfo>& foreignKeys,
            const std::vector<DBModels::ConstraintInfo>& constraints);

        // Callback: execute ALTER SQL (table, schema, sql statements)
        std::function<void(const std::vector<std::wstring>& sqls)> OnApplyAlter;

        // Set current table/schema/dbtype for ALTER generation
        void SetTableContext(const std::wstring& table, const std::wstring& schema,
                             DBModels::DatabaseType dbType = DBModels::DatabaseType::PostgreSQL);

    private:
        std::vector<DBModels::ColumnInfo>     columns_;
        std::vector<DBModels::IndexInfo>      indexes_;
        std::vector<DBModels::ForeignKeyInfo> foreignKeys_;
        std::vector<DBModels::ConstraintInfo> constraints_;
        std::vector<AlterOp> pendingAlters_;
        std::wstring tableName_;
        std::wstring schemaName_;
        DBModels::DatabaseType dbType_ = DBModels::DatabaseType::PostgreSQL;

        void Rebuild();
        void AddSectionHeader(
            winrt::Microsoft::UI::Xaml::Controls::StackPanel const& container,
            const std::wstring& title);
        void AddColumnRow(
            winrt::Microsoft::UI::Xaml::Controls::StackPanel const& container,
            const DBModels::ColumnInfo& col,
            int colIndex,
            bool isAlternate);
        void AddIndexRow(
            winrt::Microsoft::UI::Xaml::Controls::StackPanel const& container,
            const DBModels::IndexInfo& idx,
            bool isAlternate);
        void TrackAlter(const AlterOp& op);
        void UpdatePendingUI();
        std::vector<std::wstring> GenerateAlterSQL() const;
    };
}

namespace winrt::Gridex::factory_implementation
{
    struct StructureView : StructureViewT<StructureView, implementation::StructureView>
    {
    };
}
