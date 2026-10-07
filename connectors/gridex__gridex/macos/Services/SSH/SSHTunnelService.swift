// SSHTunnelService.swift
// Gridex
//
// SSH tunnel management for secure database connections.
// Uses NIOSSH for local port forwarding: localhost:localPort → remoteHost:remotePort via SSH.

import Foundation
import NIOCore
import NIOPosix
import NIOSSH

actor SSHTunnelService {
    private var activeTunnels: [UUID: SSHTunnel] = [:]

    struct SSHTunnel: Sendable {
        let connectionId: UUID
        let localPort: UInt16
        let remoteHost: String
        let remotePort: Int
        let status: TunnelStatus
        let serverChannel: Channel?
        let sshChannel: Channel?
    }

    enum TunnelStatus: Sendable {
        case connecting
        case connected
        case disconnected
        case error(String)
    }

    func establish(
        connectionId: UUID,
        config: SSHTunnelConfig,
        remoteHost: String,
        remotePort: Int,
        password: String?
    ) async throws -> UInt16 {
        let localPort = try await findFreePort()
        let group = MultiThreadedEventLoopGroup(numberOfThreads: 2)

        let authDelegate: NIOSSHClientUserAuthenticationDelegate
        switch config.authMethod {
        case .password:
            authDelegate = PasswordAuthDelegate(username: config.username, password: password ?? "")
        case .privateKey, .keyWithPassphrase:
            authDelegate = PasswordAuthDelegate(username: config.username, password: password ?? "")
            // TODO: Implement private key auth with PEM parsing
        }

        // Connect to SSH server
        let sshChannel = try await ClientBootstrap(group: group)
            .channelInitializer { channel in
                channel.pipeline.addHandlers([
                    NIOSSHHandler(
                        role: .client(.init(
                            userAuthDelegate: authDelegate,
                            serverAuthDelegate: AcceptAllHostKeysDelegate()
                        )),
                        allocator: channel.allocator,
                        inboundChildChannelInitializer: nil
                    )
                ])
            }
            .channelOption(.socketOption(.so_reuseaddr), value: 1)
            .connectTimeout(.seconds(10))
            .connect(host: config.host, port: config.port)
            .get()

        // Start local TCP server that forwards connections through SSH
        let serverChannel = try await ServerBootstrap(group: group)
            .childChannelInitializer { childChannel in
                let promise = childChannel.eventLoop.makePromise(of: Channel.self)

                sshChannel.pipeline.handler(type: NIOSSHHandler.self).whenSuccess { handler in
                    do {
                        let origin = try SocketAddress(ipAddress: "127.0.0.1", port: Int(localPort))
                        let channelType = SSHChannelType.directTCPIP(.init(
                            targetHost: remoteHost,
                            targetPort: remotePort,
                            originatorAddress: origin
                        ))
                        handler.createChannel(promise, channelType: channelType) { sshChildChannel, _ in
                            sshChildChannel.pipeline.addHandler(SSHToTCPHandler(tcpChannel: childChannel))
                        }
                    } catch {
                        promise.fail(error)
                    }
                }

                return promise.futureResult.flatMap { sshChildChannel in
                    childChannel.pipeline.addHandler(TCPToSSHHandler(sshChannel: sshChildChannel))
                }
            }
            .bind(host: "127.0.0.1", port: Int(localPort))
            .get()

        activeTunnels[connectionId] = SSHTunnel(
            connectionId: connectionId,
            localPort: localPort,
            remoteHost: remoteHost,
            remotePort: remotePort,
            status: .connected,
            serverChannel: serverChannel,
            sshChannel: sshChannel
        )

        return localPort
    }

    func disconnect(connectionId: UUID) async {
        if let tunnel = activeTunnels[connectionId] {
            try? await tunnel.serverChannel?.close()
            try? await tunnel.sshChannel?.close()
        }
        activeTunnels[connectionId] = nil
    }

    func status(connectionId: UUID) -> TunnelStatus {
        activeTunnels[connectionId]?.status ?? .disconnected
    }

    func disconnectAll() async {
        for tunnel in activeTunnels.values {
            try? await tunnel.serverChannel?.close()
            try? await tunnel.sshChannel?.close()
        }
        activeTunnels.removeAll()
    }

    // MARK: - Private

    private func findFreePort() async throws -> UInt16 {
        let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
        defer { try? group.syncShutdownGracefully() }
        let ch = try await ServerBootstrap(group: group)
            .bind(host: "127.0.0.1", port: 0)
            .get()
        guard let port = ch.localAddress?.port else {
            try await ch.close()
            throw GridexError.sshTunnelFailed
        }
        let p = UInt16(port)
        try await ch.close()
        return p
    }
}

// MARK: - Auth Delegates

private final class PasswordAuthDelegate: NIOSSHClientUserAuthenticationDelegate {
    let username: String
    let password: String
    private var offered = false

    init(username: String, password: String) {
        self.username = username
        self.password = password
    }

    func nextAuthenticationType(
        availableMethods: NIOSSHAvailableUserAuthenticationMethods,
        nextChallengePromise: EventLoopPromise<NIOSSHUserAuthenticationOffer?>
    ) {
        if !offered && availableMethods.contains(.password) {
            offered = true
            nextChallengePromise.succeed(.init(
                username: username,
                serviceName: "",
                offer: .password(.init(password: password))
            ))
        } else {
            nextChallengePromise.succeed(nil)
        }
    }
}

private final class AcceptAllHostKeysDelegate: NIOSSHClientServerAuthenticationDelegate {
    func validateHostKey(hostKey: NIOSSHPublicKey, validationCompletePromise: EventLoopPromise<Void>) {
        validationCompletePromise.succeed(())
    }
}

// MARK: - Port Forward Handlers

/// Forwards data from SSH channel → local TCP client
private final class SSHToTCPHandler: ChannelDuplexHandler {
    typealias InboundIn = SSHChannelData
    typealias OutboundIn = ByteBuffer
    typealias OutboundOut = SSHChannelData

    private let tcpChannel: Channel

    init(tcpChannel: Channel) {
        self.tcpChannel = tcpChannel
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        let channelData = unwrapInboundIn(data)
        guard case .byteBuffer(let buf) = channelData.data else { return }
        tcpChannel.writeAndFlush(buf, promise: nil)
    }

    func write(context: ChannelHandlerContext, data: NIOAny, promise: EventLoopPromise<Void>?) {
        let buf = unwrapOutboundIn(data)
        context.write(wrapOutboundOut(.init(type: .channel, data: .byteBuffer(buf))), promise: promise)
    }

    func channelInactive(context: ChannelHandlerContext) {
        tcpChannel.close(promise: nil)
        context.fireChannelInactive()
    }
}

/// Forwards data from local TCP client → SSH channel
private final class TCPToSSHHandler: ChannelDuplexHandler {
    typealias InboundIn = ByteBuffer
    typealias OutboundIn = ByteBuffer
    typealias OutboundOut = ByteBuffer

    private let sshChannel: Channel

    init(sshChannel: Channel) {
        self.sshChannel = sshChannel
    }

    func channelRead(context: ChannelHandlerContext, data: NIOAny) {
        let buf = unwrapInboundIn(data)
        sshChannel.writeAndFlush(buf, promise: nil)
    }

    func channelInactive(context: ChannelHandlerContext) {
        sshChannel.close(promise: nil)
        context.fireChannelInactive()
    }
}
