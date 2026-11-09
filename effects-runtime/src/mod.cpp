// SPDX-License-Identifier: GPL-3.0-or-later
#include "openrac/mod.hpp"
#include "config.h"
#include "plugin_list.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace {

using graphics_effects::Emitter;

struct Particle {
    int prop = -1;
    std::array<float, 3> position{};
    std::array<float, 3> velocity{};
    std::array<float, 4> tint{1, 1, 1, 1};
    float age = 0;
    float life = 1;
    float size = 0.1f;
    float grow = 0;
    float gravity = 0;
    std::uint32_t blend = OPENRAC_PROP_ADD;
};
std::vector<Emitter> read_emitters(const std::filesystem::path& plugins, openrac::Mod& mod) {
    std::vector<Emitter> out;
    std::error_code ec;
    if (plugins.empty() || !std::filesystem::is_directory(plugins, ec)) return out;

    const auto list = plugins / "plugins.json";
    std::ifstream input(list, std::ios::binary);
    if (!input) {
        mod.warn("cannot read plugins.json; authored effects stay disabled");
        return out;
    }
    std::string text((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
    if (text.size() > 4u * 1024u * 1024u) {
        mod.warn("plugins.json is unexpectedly large; authored effects stay disabled");
        return out;
    }

    std::vector<std::string> active;
    std::string expected;
    try {
        active = graphics_effects::parse_active_plugin_ids(text);
        expected = graphics_effects::effects_plugin_id(mod.game(), mod.version());
    } catch (const std::exception& error) {
        mod.warn(std::string("cannot parse plugins.json; authored effects stay disabled: ") + error.what());
        return out;
    }

    for (const auto& id : active) {
        if (id != expected) continue;
        const auto file = plugins / id / "graphics-effects.tsv";
        if (!std::filesystem::is_regular_file(file, ec)) continue;
        std::ifstream in(file);
        std::string line;
        int row = 0;
        while (std::getline(in, line)) {
            ++row;
            if (line.empty() || line[0] == '#') continue;
            try {
                out.push_back(graphics_effects::parse_emitter_line(line));
            } catch (const std::exception& error) {
                mod.warn("ignored " + id + "/graphics-effects.tsv row " + std::to_string(row) + ": " + error.what());
            }
        }
    }
    return out;
}

class Runtime {
public:
    explicit Runtime(openrac::Mod& mod) : m_mod(mod) {
        const auto root = mod.plugins_folder();
        if (root.empty()) throw openrac::Error("requires OpenRAC interface 1.14 plugins_folder");
        m_emitters = read_emitters(root, mod);
        mod.info("loaded " + std::to_string(m_emitters.size()) + " authored particle/haze emitters");
        m_last = std::chrono::steady_clock::now();
    }

    void frame() {
        const int level = m_mod.loaded_level();
        if (level != m_level) {
            clear_particles();
            if (level < 0) m_mod.haze_set({});
            m_level = level;
            for (auto& e : m_emitters) e.spawn = 0;
        }
        if (level < 0) return;

        auto now = std::chrono::steady_clock::now();
        float dt = std::chrono::duration<float>(now - m_last).count();
        m_last = now;
        if (!std::isfinite(dt) || dt <= 0 || dt > 0.1f) dt = 1.0f / 60.0f;
        dt = std::clamp(dt, 1.0f / 240.0f, 1.0f / 20.0f);

        update_haze(level);
        update_particles(dt);
        spawn(level, dt);
    }

private:
    void clear_particles() {
        for (auto& p : m_particles) {
            if (p.prop >= 0) m_mod.prop_remove(p.prop);
        }
        m_particles.clear();
    }

    float random01() {
        m_rng ^= m_rng << 13;
        m_rng ^= m_rng >> 17;
        m_rng ^= m_rng << 5;
        return float(m_rng & 0x00ffffffu) / float(0x01000000u);
    }

    float signed_random() { return random01() * 2.0f - 1.0f; }

    void update_haze(int level) {
        std::vector<openrac_haze> patches;
        for (const auto& e : m_emitters) {
            if (e.level != level || e.preset != "heat-haze" || e.haze_radius <= 0) continue;
            openrac_haze h{};
            std::copy(e.position.begin(), e.position.end(), h.position);
            h.radius = e.haze_radius;
            h.strength = e.haze_strength;
            patches.push_back(h);
            if (patches.size() >= OPENRAC_HAZE_MAX) break;
        }
        m_mod.haze_set(patches);
    }

    void spawn(int level, float dt) {
        constexpr std::size_t kMaxParticles = 192;
        for (auto& e : m_emitters) {
            if (e.level != level || e.preset == "heat-haze" || e.rate <= 0) continue;
            e.spawn += e.rate * dt;
            int count = std::min(8, int(e.spawn));
            e.spawn -= count;
            while (count-- > 0 && m_particles.size() < kMaxParticles) {
                Particle p;
                p.position = e.position;
                p.life = e.life;
                p.size = e.size;
                p.gravity = e.gravity;
                p.tint = {e.colour[0], e.colour[1], e.colour[2], e.alpha};
                p.blend = (e.preset == "smoke" || e.preset == "smog" || e.preset == "mist" || e.preset == "rain")
                    ? OPENRAC_PROP_ALPHA : OPENRAC_PROP_ADD;

                if (e.preset == "rain") {
                    p.position[0] += signed_random() * e.spread;
                    p.position[1] += signed_random() * e.spread;
                    p.position[2] += random01() * e.spread;
                    p.velocity = {signed_random() * 0.2f, signed_random() * 0.2f, -e.speed};
                } else if (e.preset == "smoke" || e.preset == "smog" || e.preset == "mist") {
                    p.velocity = {signed_random() * e.spread, signed_random() * e.spread,
                                  e.speed * (0.5f + random01())};
                    p.grow = e.preset == "smoke" ? e.size * 0.7f : e.preset == "smog" ? e.size * 0.15f : e.size * 0.25f;
                } else if (e.preset == "glow") {
                    p.position[0] += signed_random() * e.spread;
                    p.position[1] += signed_random() * e.spread;
                    p.position[2] += signed_random() * e.spread;
                    p.velocity = {signed_random() * e.speed, signed_random() * e.speed, signed_random() * e.speed};
                } else {
                    p.velocity = {signed_random() * e.spread, signed_random() * e.spread,
                                  e.speed * (0.35f + random01())};
                }
                p.prop = m_mod.prop_create("assets/particle.glb");
                if (p.prop >= 0) m_particles.push_back(p);
            }
        }
    }

    void update_particles(float dt) {
        for (auto& p : m_particles) {
            p.age += dt;
            p.position[0] += p.velocity[0] * dt;
            p.position[1] += p.velocity[1] * dt;
            p.position[2] += p.velocity[2] * dt;
            p.velocity[2] += p.gravity * dt;
            const float t = std::clamp(p.age / p.life, 0.0f, 1.0f);
            const float size = std::max(0.001f, p.size + p.grow * p.age);
            const float alpha = p.tint[3] * (1.0f - t);
            float matrix[16] = {
                size,0,0,0,
                0,size,0,0,
                0,0,size,0,
                p.position[0],p.position[1],p.position[2],1,
            };
            float tint[4] = {p.tint[0],p.tint[1],p.tint[2],alpha};
            if (!m_mod.prop_pose(p.prop, matrix, tint, p.blend)) p.age = p.life;
        }

        for (auto it = m_particles.begin(); it != m_particles.end();) {
            if (it->age >= it->life) {
                if (it->prop >= 0) m_mod.prop_remove(it->prop);
                it = m_particles.erase(it);
            } else {
                ++it;
            }
        }
    }

    openrac::Mod& m_mod;
    std::vector<Emitter> m_emitters;
    std::vector<Particle> m_particles;
    int m_level = -2;
    std::uint32_t m_rng = 0x61c88647u;
    std::chrono::steady_clock::time_point m_last;
};

Runtime* g_runtime = nullptr;

void load(openrac::Mod& mod) {
    if (!mod.has_api_12()) throw openrac::Error("requires OpenRAC mod API 1.12 particle/prop support");
    static Runtime runtime(mod);
    g_runtime = &runtime;
    mod.on_frame([] { if (g_runtime) g_runtime->frame(); });
}

} // namespace

#ifndef GRAPHICS_EFFECTS_MOD_ID
#define GRAPHICS_EFFECTS_MOD_ID "graphics-effects-runtime"
#endif
#ifndef GRAPHICS_EFFECTS_MOD_VERSION
#define GRAPHICS_EFFECTS_MOD_VERSION "0.1.2"
#endif

OPENRAC_MOD_CPP(GRAPHICS_EFFECTS_MOD_ID, GRAPHICS_EFFECTS_MOD_VERSION, load)
