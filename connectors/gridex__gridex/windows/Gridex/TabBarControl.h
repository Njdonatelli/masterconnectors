#pragma once

#include "TabBarControl.g.h"
#include <functional>
#include <vector>
#include <string>

namespace winrt::Gridex::implementation
{
    struct TabEntry
    {
        std::wstring id;
        std::wstring title;
    };

    struct TabBarControl : TabBarControlT<TabBarControl>
    {
        TabBarControl();

        void AddTab(winrt::hstring const& id, winrt::hstring const& title);
        void SetActiveTab(winrt::hstring const& id);
        void CloseTab(winrt::hstring const& id);

        // Callback fired when active tab changes
        std::function<void(const std::wstring& id)> OnTabChanged;
        // Callback fired when + button pressed
        std::function<void()> OnNewTab;
        // Callback fired when a tab is closed via the X button
        std::function<void(const std::wstring& id)> OnTabClosed;


    private:
        std::vector<TabEntry> tabs_;
        std::wstring activeId_;

        void RebuildStrip();
        void SelectTab(const std::wstring& id);
    };
}

namespace winrt::Gridex::factory_implementation
{
    struct TabBarControl : TabBarControlT<TabBarControl, implementation::TabBarControl>
    {
    };
}
