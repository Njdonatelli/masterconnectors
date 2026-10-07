// SSHTunnelService.cpp — SSH local port forwarding via libssh2.
//
// Opens an SSH connection, binds a local TCP socket on a free port,
// and forwards traffic through the SSH channel to the remote DB host.
// The forwarding loop runs on a detached background thread and stops
// when close() sets active_ = false.

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <libssh2.h>
#include "Models/SSHTunnelService.h"
#include "Models/DatabaseAdapter.h"

#include <fstream>
#include <vector>

#pragma comment(lib, "ws2_32.lib")

namespace DBModels
{
    // ── Helpers ───────────────────────────────────────────────
    std::string SSHTunnelService::toUtf8(const std::wstring& s)
    {
        if (s.empty()) return {};
        int sz = WideCharToMultiByte(CP_UTF8, 0, s.c_str(),
            static_cast<int>(s.size()), nullptr, 0, nullptr, nullptr);
        std::string out(sz, '\0');
        WideCharToMultiByte(CP_UTF8, 0, s.c_str(),
            static_cast<int>(s.size()), &out[0], sz, nullptr, nullptr);
        return out;
    }

    uint16_t SSHTunnelService::findFreePort()
    {
        SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (s == INVALID_SOCKET) return 0;

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        addr.sin_port = 0; // OS picks free port

        if (bind(s, (sockaddr*)&addr, sizeof(addr)) != 0)
        {
            closesocket(s);
            return 0;
        }

        int addrLen = sizeof(addr);
        getsockname(s, (sockaddr*)&addr, &addrLen);
        uint16_t port = ntohs(addr.sin_port);
        closesocket(s);
        return port;
    }

    // ── Constructor / Destructor ──────────────────────────────
    SSHTunnelService::SSHTunnelService()
    {
        // Ensure Winsock is initialized (safe to call multiple times)
        WSADATA wsa;
        WSAStartup(MAKEWORD(2, 2), &wsa);
    }

    SSHTunnelService::~SSHTunnelService()
    {
        close();
    }

    // ── Establish tunnel ─────────────────────────────────────
    uint16_t SSHTunnelService::establish(
        const SSHTunnelConfig& config,
        const std::wstring& sshPassword,
        const std::string& remoteHost,
        int remotePort)
    {
        close(); // tear down any existing tunnel

        remoteHost_ = remoteHost;
        remotePort_ = remotePort;

        auto sshHost = toUtf8(config.host.empty() ? L"127.0.0.1" : config.host);
        auto sshUser = toUtf8(config.username);
        auto sshPass = toUtf8(sshPassword);
        auto sshKeyPath = toUtf8(config.keyPath);
        int  sshPort = config.port > 0 ? config.port : 22;

        // 1. TCP connect to SSH server
        struct addrinfo hints{}, *res = nullptr;
        hints.ai_family = AF_INET;
        hints.ai_socktype = SOCK_STREAM;

        if (getaddrinfo(sshHost.c_str(), std::to_string(sshPort).c_str(),
                        &hints, &res) != 0 || !res)
        {
            throw DatabaseError(DatabaseError::Code::SSHTunnelFailed,
                "Cannot resolve SSH host: " + sshHost);
        }

        SOCKET sock = socket(res->ai_family, res->ai_socktype, res->ai_protocol);
        if (sock == INVALID_SOCKET)
        {
            freeaddrinfo(res);
            throw DatabaseError(DatabaseError::Code::SSHTunnelFailed,
                "Cannot create socket for SSH");
        }

        // Set 15-second connect timeout
        DWORD timeout = 15000;
        setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (char*)&timeout, sizeof(timeout));
        setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, (char*)&timeout, sizeof(timeout));

        if (::connect(sock, res->ai_addr, (int)res->ai_addrlen) != 0)
        {
            closesocket(sock);
            freeaddrinfo(res);
            throw DatabaseError(DatabaseError::Code::SSHTunnelFailed,
                "Cannot connect to SSH server " + sshHost + ":" + std::to_string(sshPort));
        }
        freeaddrinfo(res);
        sshSock_ = static_cast<uintptr_t>(sock);

        // 2. Initialize libssh2 session
        libssh2_init(0);
        session_ = libssh2_session_init();
        if (!session_)
        {
            closesocket(sock);
            sshSock_ = ~0ULL;
            throw DatabaseError(DatabaseError::Code::SSHTunnelFailed,
                "libssh2_session_init failed");
        }

        // Set blocking mode for handshake
        libssh2_session_set_blocking(session_, 1);

        if (libssh2_session_handshake(session_, (libssh2_socket_t)sock) != 0)
        {
            char* errMsg = nullptr;
            libssh2_session_last_error(session_, &errMsg, nullptr, 0);
            std::string err = errMsg ? errMsg : "SSH handshake failed";
            libssh2_session_free(session_); session_ = nullptr;
            closesocket(sock); sshSock_ = ~0ULL;
            throw DatabaseError(DatabaseError::Code::SSHTunnelFailed, err);
        }

        // 3. Authenticate
        int authRc = -1;
        if (config.authMethod == SSHAuthMethod::Password || sshKeyPath.empty())
        {
            // Password auth
            authRc = libssh2_userauth_password(session_,
                sshUser.c_str(), sshPass.c_str());
        }
        else
        {
            // Key-based auth (PrivateKey or KeyWithPassphrase)
            const char* passphrase = sshPass.empty() ? nullptr : sshPass.c_str();
            authRc = libssh2_userauth_publickey_fromfile(session_,
                sshUser.c_str(),
                nullptr,             // public key (auto-derive from private)
                sshKeyPath.c_str(),
                passphrase);
        }

        if (authRc != 0)
        {
            char* errMsg = nullptr;
            libssh2_session_last_error(session_, &errMsg, nullptr, 0);
            std::string err = errMsg ? errMsg : "SSH authentication failed";
            libssh2_session_disconnect(session_, "auth failed");
            libssh2_session_free(session_); session_ = nullptr;
            closesocket(sock); sshSock_ = ~0ULL;
            throw DatabaseError(DatabaseError::Code::SSHTunnelFailed, err);
        }

        // 4. Bind local listener
        localPort_ = findFreePort();
        if (localPort_ == 0)
        {
            libssh2_session_disconnect(session_, "no free port");
            libssh2_session_free(session_); session_ = nullptr;
            closesocket(sock); sshSock_ = ~0ULL;
            throw DatabaseError(DatabaseError::Code::SSHTunnelFailed,
                "Cannot find free local port for SSH tunnel");
        }

        SOCKET lsock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        sockaddr_in laddr{};
        laddr.sin_family = AF_INET;
        laddr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        laddr.sin_port = htons(localPort_);

        if (bind(lsock, (sockaddr*)&laddr, sizeof(laddr)) != 0 ||
            listen(lsock, 1) != 0)
        {
            closesocket(lsock);
            libssh2_session_disconnect(session_, "bind failed");
            libssh2_session_free(session_); session_ = nullptr;
            closesocket(sock); sshSock_ = ~0ULL;
            throw DatabaseError(DatabaseError::Code::SSHTunnelFailed,
                "Cannot bind local port " + std::to_string(localPort_));
        }
        listenSock_ = static_cast<uintptr_t>(lsock);

        // 5. Start forwarding thread
        active_ = true;
        forwardThread_ = std::thread(&SSHTunnelService::forwardLoop, this);

        return localPort_;
    }

    // ── Forward loop (background thread) ─────────────────────
    void SSHTunnelService::forwardLoop()
    {
        SOCKET lsock = static_cast<SOCKET>(listenSock_);

        while (active_)
        {
            // Non-blocking accept with 1-second timeout via select
            fd_set fds;
            FD_ZERO(&fds);
            FD_SET(lsock, &fds);
            timeval tv{1, 0};

            int sel = select(0, &fds, nullptr, nullptr, &tv);
            if (sel <= 0) continue;

            sockaddr_in clientAddr{};
            int clientLen = sizeof(clientAddr);
            SOCKET clientSock = accept(lsock, (sockaddr*)&clientAddr, &clientLen);
            if (clientSock == INVALID_SOCKET) continue;

            // Open SSH direct-tcpip channel to remote DB
            LIBSSH2_CHANNEL* channel = libssh2_channel_direct_tcpip(
                session_, remoteHost_.c_str(), remotePort_);

            if (!channel)
            {
                closesocket(clientSock);
                continue;
            }

            // Bidirectional forward until either side closes
            libssh2_session_set_blocking(session_, 0);
            char buf[16384];

            while (active_)
            {
                // Client → SSH channel
                fd_set rds;
                FD_ZERO(&rds);
                FD_SET(clientSock, &rds);
                timeval poll{0, 100000}; // 100ms

                if (select(0, &rds, nullptr, nullptr, &poll) > 0)
                {
                    int n = recv(clientSock, buf, sizeof(buf), 0);
                    if (n <= 0) break;
                    // Write all to channel
                    int written = 0;
                    while (written < n)
                    {
                        int w = libssh2_channel_write(channel, buf + written, n - written);
                        if (w == LIBSSH2_ERROR_EAGAIN) { Sleep(1); continue; }
                        if (w < 0) goto done;
                        written += w;
                    }
                }

                // SSH channel → Client
                for (;;)
                {
                    int n = libssh2_channel_read(channel, buf, sizeof(buf));
                    if (n == LIBSSH2_ERROR_EAGAIN) break;
                    if (n <= 0) goto done;
                    send(clientSock, buf, n, 0);
                }

                if (libssh2_channel_eof(channel)) break;
            }

        done:
            libssh2_channel_close(channel);
            libssh2_channel_free(channel);
            closesocket(clientSock);

            // Reset to blocking for next channel open
            if (session_)
                libssh2_session_set_blocking(session_, 1);
        }
    }

    // ── Close tunnel ─────────────────────────────────────────
    void SSHTunnelService::close()
    {
        active_ = false;

        // Close listen socket to unblock accept in forwardLoop
        if (listenSock_ != ~0ULL)
        {
            closesocket(static_cast<SOCKET>(listenSock_));
            listenSock_ = ~0ULL;
        }

        if (forwardThread_.joinable())
            forwardThread_.join();

        if (session_)
        {
            libssh2_session_disconnect(session_, "Normal shutdown");
            libssh2_session_free(session_);
            session_ = nullptr;
        }

        if (sshSock_ != ~0ULL)
        {
            closesocket(static_cast<SOCKET>(sshSock_));
            sshSock_ = ~0ULL;
        }

        localPort_ = 0;
    }
}
