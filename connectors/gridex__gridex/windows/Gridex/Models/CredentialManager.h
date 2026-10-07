#pragma once
#include <string>

namespace DBModels
{
    // Wrapper around Windows Credential Manager (CredRead/CredWrite/CredDelete)
    // Stores connection passwords securely using DPAPI
    class CredentialManager
    {
    public:
        // Save password for a connection ID
        static bool Save(const std::wstring& connectionId, const std::wstring& password);

        // Load password for a connection ID (returns empty if not found)
        static std::wstring Load(const std::wstring& connectionId);

        // Remove stored password for a connection ID
        static bool Remove(const std::wstring& connectionId);

        // Check if credentials exist for a connection ID
        static bool Exists(const std::wstring& connectionId);

    private:
        // Prefix for all credential target names
        static std::wstring TargetName(const std::wstring& connectionId);
        static constexpr const wchar_t* TARGET_PREFIX = L"Gridex:";
    };
}
