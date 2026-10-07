#pragma once
// SSHTunnelService — local port forwarding via libssh2.
//
// Creates a TCP listener on localhost:<freePort> and forwards all
// incoming connections through an SSH tunnel to remoteHost:remotePort.
// The DB adapter then connects to localhost:<freePort> instead of
// the remote database host directly.
//
// Lifecycle:
//   1. establish(config, remoteHost, remotePort) → returns localPort
//   2. DB adapter connects to 127.0.0.1:localPort
//   3. close() tears down tunnel + SSH session
//
// Auth: password and private-key (PEM/OpenSSH format).
// Thread: tunnel runs a forwarding loop on a background std::thread.

#include "ConnectionConfig.h"
#include <string>
#include <thread>
#include <atomic>
#include <cstdint>

// Forward-declare libssh2 types
typedef struct _LIBSSH2_SESSION LIBSSH2_SESSION;

namespace DBModels
{
    class SSHTunnelService
    {
    public:
        SSHTunnelService();
        ~SSHTunnelService();

        // Open SSH tunnel. Returns the local port to connect DB to.
        // Throws DatabaseError on failure.
        uint16_t establish(
            const SSHTunnelConfig& config,
            const std::wstring& sshPassword,
            const std::string& remoteHost,
            int remotePort);

        // Close tunnel and free resources.
        void close();

        bool isActive() const { return active_.load(); }
        uint16_t localPort() const { return localPort_; }

    private:
        LIBSSH2_SESSION* session_ = nullptr;
        uintptr_t sshSock_ = ~0ULL;   // SOCKET (INVALID_SOCKET)
        uintptr_t listenSock_ = ~0ULL;
        uint16_t localPort_ = 0;
        std::string remoteHost_;
        int remotePort_ = 0;
        std::atomic<bool> active_{false};
        std::thread forwardThread_;

        void forwardLoop();
        static uint16_t findFreePort();
        static std::string toUtf8(const std::wstring& s);
    };
}
