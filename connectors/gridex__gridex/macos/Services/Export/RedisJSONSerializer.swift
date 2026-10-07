// RedisJSONSerializer.swift
// Gridex
//
// Serialize/deserialize RedisKeyEntry as JSON for backup/restore.
// Format (one entry per line in NDJSON):
//   {"key":"...","type":"string","ttl":null,"value":"hello"}
//   {"key":"...","type":"list","ttl":60,"value":["a","b","c"]}
//   {"key":"...","type":"zset","ttl":null,"value":[{"m":"a","s":1.0},...]}
//   {"key":"...","type":"hash","ttl":null,"value":{"f1":"v1","f2":"v2"}}

import Foundation

enum RedisJSONSerializer {
    static func serialize(_ entry: RedisAdapter.RedisKeyEntry) -> String {
        var json: [String: Any] = [
            "key": entry.key,
            "type": entry.type,
        ]
        json["ttl"] = entry.ttl as Any? ?? NSNull()

        switch entry.value {
        case .string(let s):
            json["value"] = s
        case .list(let items):
            json["value"] = items
        case .set(let members):
            json["value"] = Array(members)
        case .zset(let pairs):
            json["value"] = pairs.map { ["m": $0.0, "s": $0.1] as [String: Any] }
        case .hash(let dict):
            json["value"] = dict
        }

        if let data = try? JSONSerialization.data(withJSONObject: json),
           let str = String(data: data, encoding: .utf8) {
            return str
        }
        return "{}"
    }

    static func deserialize(_ line: String) -> RedisAdapter.RedisKeyEntry? {
        guard let data = line.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let key = json["key"] as? String,
              let type = json["type"] as? String else {
            return nil
        }
        let ttl: Int? = (json["ttl"] as? Int)

        let value: RedisAdapter.RedisKeyEntry.Value
        switch type {
        case "string":
            value = .string((json["value"] as? String) ?? "")
        case "list":
            value = .list((json["value"] as? [String]) ?? [])
        case "set":
            value = .set((json["value"] as? [String]) ?? [])
        case "zset":
            let pairs = (json["value"] as? [[String: Any]]) ?? []
            value = .zset(pairs.compactMap { dict in
                guard let m = dict["m"] as? String,
                      let s = dict["s"] as? Double else { return nil }
                return (m, s)
            })
        case "hash":
            value = .hash((json["value"] as? [String: String]) ?? [:])
        default:
            return nil
        }

        return RedisAdapter.RedisKeyEntry(key: key, type: type, ttl: ttl, value: value)
    }
}
