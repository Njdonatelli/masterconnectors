#include "pch.h"
#include "xaml-includes.h"
#include <winrt/Windows.UI.h>
#include "TabBarControl.h"
#if __has_include("TabBarControl.g.cpp")
#include "TabBarControl.g.cpp"
#endif

namespace winrt::Gridex::implementation
{
    namespace mux  = winrt::Microsoft::UI::Xaml;
    namespace muxc = winrt::Microsoft::UI::Xaml::Controls;
    namespace muxm = winrt::Microsoft::UI::Xaml::Media;

    TabBarControl::TabBarControl()
    {
        InitializeComponent();

        this->Loaded([this](winrt::Windows::Foundation::IInspectable const&, mux::RoutedEventArgs const&)
        {
            NewTabBtn().Click([this](winrt::Windows::Foundation::IInspectable const&, mux::RoutedEventArgs const&)
            {
                if (OnNewTab) OnNewTab();
            });
        });
    }

    void TabBarControl::AddTab(winrt::hstring const& id, winrt::hstring const& title)
    {
        TabEntry entry{ std::wstring(id), std::wstring(title) };
        tabs_.push_back(entry);
        RebuildStrip();
    }

    void TabBarControl::SetActiveTab(winrt::hstring const& id)
    {
        activeId_ = std::wstring(id);
        RebuildStrip();
    }

    void TabBarControl::CloseTab(winrt::hstring const& id)
    {
        std::wstring closeId(id);
        tabs_.erase(
            std::remove_if(tabs_.begin(), tabs_.end(),
                [&](const TabEntry& e) { return e.id == closeId; }),
            tabs_.end());

        bool wasActive = (activeId_ == closeId);
        if (wasActive)
            activeId_ = tabs_.empty() ? L"" : tabs_.back().id;

        RebuildStrip();

        // Notify host so it can sync its own tab state and content view
        if (OnTabClosed) OnTabClosed(closeId);
        // If active tab changed (because we closed the active one), fire that too
        if (wasActive && OnTabChanged) OnTabChanged(activeId_);
    }

    void TabBarControl::RebuildStrip()
    {
        TabStrip().Children().Clear();

        for (auto& entry : tabs_)
        {
            bool isActive = (entry.id == activeId_);

            muxc::Button btn;
            btn.Padding(mux::Thickness{ 12.0, 0.0, 8.0, 0.0 });
            btn.Height(36.0);
            btn.BorderThickness(mux::Thickness{ 0, 0, 0, isActive ? 2.0 : 0.0 });
            if (isActive)
            {
                mux::Media::SolidColorBrush accent;
                accent.Color(winrt::Windows::UI::ColorHelper::FromArgb(255, 0, 120, 212));
                btn.BorderBrush(accent);
                btn.Background(muxm::SolidColorBrush(winrt::Windows::UI::Colors::Transparent()));
            }
            else
            {
                btn.Background(muxm::SolidColorBrush(winrt::Windows::UI::Colors::Transparent()));
            }

            muxc::StackPanel row;
            row.Orientation(muxc::Orientation::Horizontal);
            row.Spacing(6.0);

            muxc::TextBlock lbl;
            lbl.Text(winrt::hstring(entry.title));
            lbl.FontSize(12.0);
            lbl.VerticalAlignment(mux::VerticalAlignment::Center);
            lbl.Opacity(isActive ? 1.0 : 0.7);
            row.Children().Append(lbl);

            // Close (x) button
            muxc::Button closeBtn;
            closeBtn.Width(16.0);
            closeBtn.Height(16.0);
            closeBtn.Padding(mux::Thickness{ 0,0,0,0 });
            closeBtn.Background(muxm::SolidColorBrush(winrt::Windows::UI::Colors::Transparent()));
            closeBtn.BorderThickness(mux::Thickness{ 0,0,0,0 });
            muxc::FontIcon closeIcon;
            closeIcon.Glyph(L"\xE711");
            closeIcon.FontSize(8.0);
            closeBtn.Content(closeIcon);

            std::wstring capturedId = entry.id;
            closeBtn.Click([this, capturedId](auto&&, auto&&)
            {
                CloseTab(winrt::hstring(capturedId));
            });
            row.Children().Append(closeBtn);

            btn.Content(row);

            std::wstring tabId = entry.id;
            btn.Click([this, tabId](auto&&, auto&&)
            {
                SelectTab(tabId);
            });

            TabStrip().Children().Append(btn);
        }
    }

    void TabBarControl::SelectTab(const std::wstring& id)
    {
        activeId_ = id;
        RebuildStrip();
        if (OnTabChanged)
            OnTabChanged(id);
    }

    // NewTab_Click removed — wired in code-behind via Loaded
}
