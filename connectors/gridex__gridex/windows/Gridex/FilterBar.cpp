#include "pch.h"
#include "xaml-includes.h"
#include "FilterBar.h"
#if __has_include("FilterBar.g.cpp")
#include "FilterBar.g.cpp"
#endif

namespace winrt::Gridex::implementation
{
    namespace mux  = winrt::Microsoft::UI::Xaml;
    namespace muxc = winrt::Microsoft::UI::Xaml::Controls;

    FilterBar::FilterBar()
    {
        InitializeComponent();
    }

    void FilterBar::SetColumns(const std::vector<std::wstring>& columnNames)
    {
        columns_ = columnNames;
        ColumnPicker().Items().Clear();
        for (auto& col : columns_)
        {
            muxc::ComboBoxItem item;
            item.Content(winrt::box_value(winrt::hstring(col)));
            ColumnPicker().Items().Append(item);
        }
        if (!columns_.empty())
            ColumnPicker().SelectedIndex(0);
    }

    void FilterBar::ApplyFilter_Click(
        winrt::Windows::Foundation::IInspectable const&,
        mux::RoutedEventArgs const&)
    {
        if (!OnApplyFilter) return;

        FilterCondition cond;

        // Column
        if (ColumnPicker().SelectedItem())
        {
            auto item = ColumnPicker().SelectedItem().try_as<muxc::ComboBoxItem>();
            if (item)
                cond.column = std::wstring(winrt::unbox_value<winrt::hstring>(item.Content()));
        }

        // Operator
        if (OperatorPicker().SelectedItem())
        {
            auto item = OperatorPicker().SelectedItem().try_as<muxc::ComboBoxItem>();
            if (item)
                cond.op = std::wstring(winrt::unbox_value<winrt::hstring>(item.Content()));
        }
        else
        {
            cond.op = L"equals";
        }

        cond.value = std::wstring(FilterValue().Text());
        OnApplyFilter(cond);
    }

    void FilterBar::ClearFilter_Click(
        winrt::Windows::Foundation::IInspectable const&,
        mux::RoutedEventArgs const&)
    {
        FilterValue().Text(L"");
        if (!columns_.empty())
            ColumnPicker().SelectedIndex(0);
        OperatorPicker().SelectedIndex(0);

        if (OnClearFilter)
            OnClearFilter();
    }
}
