#include <windows.h>
#include "Models/CredentialManager.h"
#include <wincred.h>
#pragma comment(lib, "Advapi32.lib")

namespace DBModels
{
    std::wstring CredentialManager::TargetName(const std::wstring& connectionId)
    {
        return std::wstring(TARGET_PREFIX) + connectionId;
    }

    bool CredentialManager::Save(const std::wstring& connectionId, const std::wstring& password)
    {
        std::wstring target = TargetName(connectionId);

        // Convert password to byte blob
        DWORD blobSize = static_cast<DWORD>(password.size() * sizeof(wchar_t));

        CREDENTIALW cred = {};
        cred.Type = CRED_TYPE_GENERIC;
        cred.TargetName = const_cast<LPWSTR>(target.c_str());
        cred.CredentialBlobSize = blobSize;
        cred.CredentialBlob = reinterpret_cast<LPBYTE>(const_cast<wchar_t*>(password.c_str()));
        cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
        cred.UserName = const_cast<LPWSTR>(L"Gridex");

        return CredWriteW(&cred, 0) == TRUE;
    }

    std::wstring CredentialManager::Load(const std::wstring& connectionId)
    {
        std::wstring target = TargetName(connectionId);

        PCREDENTIALW pCred = nullptr;
        if (!CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &pCred))
            return L"";

        std::wstring password;
        if (pCred->CredentialBlob && pCred->CredentialBlobSize > 0)
        {
            DWORD charCount = pCred->CredentialBlobSize / sizeof(wchar_t);
            password.assign(
                reinterpret_cast<const wchar_t*>(pCred->CredentialBlob),
                charCount);
        }

        CredFree(pCred);
        return password;
    }

    bool CredentialManager::Remove(const std::wstring& connectionId)
    {
        std::wstring target = TargetName(connectionId);
        return CredDeleteW(target.c_str(), CRED_TYPE_GENERIC, 0) == TRUE;
    }

    bool CredentialManager::Exists(const std::wstring& connectionId)
    {
        std::wstring target = TargetName(connectionId);
        PCREDENTIALW pCred = nullptr;
        if (CredReadW(target.c_str(), CRED_TYPE_GENERIC, 0, &pCred))
        {
            CredFree(pCred);
            return true;
        }
        return false;
    }
}
