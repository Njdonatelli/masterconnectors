#pragma once

#include "FilterBar.g.h"
#include <functional>
#include <string>
#include <vector>

namespace winrt::Gridex::implementation
{
    struct FilterCondition
    {
        std::wstring column;
        std::wstring op;     // equals, contains, starts with, is null, etc.
        std::wstring value;
    };

    struct FilterBar : FilterBarT<FilterBar>
    {
        FilterBar();

        // Populate the column picker from active table columns
        void SetColumns(const std::vector<std::wstring>& columnNames);

        // Callbacks fired by Apply / Clear
        std::function<void(const FilterCondition&)> OnApplyFilter;
        std::function<void()>                       OnClearFilter;

        void ApplyFilter_Click(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e);
        void ClearFilter_Click(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& e);

    private:
        std::vector<std::wstring> columns_;
    };
}

namespace winrt::Gridex::factory_implementation
{
    struct FilterBar : FilterBarT<FilterBar, implementation::FilterBar>
    {
    };
}
