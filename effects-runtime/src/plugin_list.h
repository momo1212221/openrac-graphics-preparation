// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <cctype>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace graphics_effects {
class JsonCursor {
public:
    explicit JsonCursor(std::string_view text) : m_text(text) {}
    void ws() { while (m_at < m_text.size() && std::isspace(static_cast<unsigned char>(m_text[m_at]))) ++m_at; }
    bool take(char c) { ws(); if (m_at < m_text.size() && m_text[m_at] == c) { ++m_at; return true; } return false; }
    void need(char c) { if (!take(c)) throw std::runtime_error("invalid plugins.json"); }
    std::string string() {
        ws(); if (m_at >= m_text.size() || m_text[m_at++] != '"') throw std::runtime_error("expected JSON string");
        std::string out;
        while (m_at < m_text.size()) {
            const char c = m_text[m_at++];
            if (c == '"') return out;
            if (static_cast<unsigned char>(c) < 0x20) throw std::runtime_error("control byte in JSON string");
            if (c != '\\') { out += c; continue; }
            if (m_at >= m_text.size()) throw std::runtime_error("unfinished JSON escape");
            const char e = m_text[m_at++];
            switch (e) {
                case '"': out += '"'; break; case '\\': out += '\\'; break; case '/': out += '/'; break;
                case 'b': out += '\b'; break; case 'f': out += '\f'; break; case 'n': out += '\n'; break;
                case 'r': out += '\r'; break; case 't': out += '\t'; break;
                case 'u':
                    if (m_at + 4 > m_text.size()) throw std::runtime_error("unfinished unicode escape");
                    for (int n = 0; n < 4; ++n) if (!std::isxdigit(static_cast<unsigned char>(m_text[m_at+n]))) throw std::runtime_error("bad unicode escape");
                    m_at += 4; out += '?'; break;
                default: throw std::runtime_error("bad JSON escape");
            }
        }
        throw std::runtime_error("unterminated JSON string");
    }
    bool boolean() {
        ws();
        if (m_text.substr(m_at,4) == "true") { m_at += 4; return true; }
        if (m_text.substr(m_at,5) == "false") { m_at += 5; return false; }
        throw std::runtime_error("enabled must be boolean");
    }
    void skip_string() { (void)string(); }
    void skip_value() {
        ws(); if (m_at >= m_text.size()) throw std::runtime_error("missing JSON value");
        if (m_text[m_at] == '"') { skip_string(); return; }
        if (take('{')) {
            if (take('}')) return;
            do { skip_string(); need(':'); skip_value(); } while (take(','));
            need('}'); return;
        }
        if (take('[')) {
            if (take(']')) return;
            do { skip_value(); } while (take(','));
            need(']'); return;
        }
        const std::size_t start=m_at;
        while (m_at<m_text.size()) {
            const char c=m_text[m_at];
            if (c==','||c==']'||c=='}'||std::isspace(static_cast<unsigned char>(c))) break;
            ++m_at;
        }
        if (m_at==start) throw std::runtime_error("invalid JSON value");
    }
    bool done() { ws(); return m_at == m_text.size(); }
private:
    std::string_view m_text; std::size_t m_at=0;
};

inline bool safe_plugin_id(std::string_view id) {
    if (id.empty() || id.size() > 128) return false;
    for (unsigned char c : id) if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return false;
    return true;
}

inline std::vector<std::string> parse_active_plugin_ids(std::string_view text) {
    JsonCursor c(text); std::vector<std::string> out;
    c.need('{');
    if (!c.take('}')) {
        do {
            const std::string key=c.string(); c.need(':');
            if (key != "mods") { c.skip_value(); continue; }
            c.need('[');
            if (!c.take(']')) {
                do {
                    c.need('{'); std::string id; bool enabled=false;
                    if (!c.take('}')) {
                        do {
                            const std::string field=c.string(); c.need(':');
                            if (field=="id") id=c.string();
                            else if (field=="enabled") enabled=c.boolean();
                            else c.skip_value();
                        } while (c.take(','));
                        c.need('}');
                    }
                    if (enabled) {
                        if (!safe_plugin_id(id)) throw std::runtime_error("unsafe enabled plugin id");
                        bool duplicate=false; for (const auto& known:out) duplicate |= known==id;
                        if (!duplicate) out.push_back(std::move(id));
                    }
                } while (c.take(','));
                c.need(']');
            }
        } while (c.take(','));
        c.need('}');
    }
    if (!c.done()) throw std::runtime_error("trailing data in plugins.json");
    return out;
}
inline std::string effects_plugin_id(std::string_view game, std::string_view version) {
    const auto safe_part=[](std::string_view part) {
        if (part.empty()) return false;
        for (unsigned char c : part) {
            if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-')) return false;
        }
        return true;
    };
    if (!safe_part(game) || !safe_part(version)) throw std::runtime_error("unsafe game/version id");
    return "graphics-effects-" + std::string(game) + "-" + std::string(version);
}
} // namespace graphics_effects
