// SPDX-License-Identifier: GPL-3.0-or-later
#include "openrac/mod.hpp"

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

struct Emitter {
    int level = -1;
    std::string preset;
    std::array<float, 3> position{};
    std::array<float, 3> colour{1, 1, 1};
    float alpha = 1;
    float rate = 0;
    float life = 1;
    float size = 0.1f;
    float speed = 1;
    float spread = 1;
    float gravity = 0;
    float haze_radius = 0;
    float haze_strength = 0;
    float spawn = 0;
};

struct Particle {
    int prop = -1;
    std::array<float, 3> position{};
    std::array<float, 3> velocity{};
    std::array<float, 4> tint{1, 1, 1, 1};
    float age = 0;
    float life = 1;
    float size = 0.1f;
    float grow = 0;
    std::uint32_t blend = OPENRAC_PROP_ADD;
};

std::vector<std::string> split_tabs(const std::string& line) {
    std::vector<std::string> out;
    std::size_t at = 0;
    while (true) {
        const auto next = line.find('\t', at);
        out.push_back(line.substr(at, next == std::string::npos ? next : next - at));
        if (next == std::string::npos) break;
        at = next + 1;
    }
    return out;
}

float number(const std::string& text) {
    std::size_t used = 0;
    const float value = std::stof(text, &used);
    if (used != text.size() || !std::isfinite(value)) throw std::runtime_error("invalid number");
    return value;
}

int integer(const std::string& text) {
    std::size_t used = 0;
    const int value = std::stoi(text, &used);
    if (used != text.size()) throw std::runtime_error("invalid integer");
    return value;
}

bool known_preset(const std::string& preset) {
    return preset == "sparks" || preset == "smoke" || preset == "mist" ||
           preset == "glow" || preset == "energy" || preset == "rain" ||
           preset == "heat-haze";
}

std::vector<Emitter> read_emitters(const std::filesystem::path& plugins, openrac::Mod& mod) {
    std::vector<Emitter> out;
    std::error_code ec;
    if (plugins.empty() || !std::filesystem::is_directory(plugins, ec)) return out;

    for (const auto& entry : std::filesystem::directory_iterator(plugins, ec)) {
        if (ec || !entry.is_directory()) continue;
        const auto file = entry.path() / "graphics-effects.tsv";
        if (!std::filesystem::is_regular_file(file, ec)) continue;

        std::ifstream in(file);
        std::string line;
        int row = 0;
        while (std::getline(in, line)) {
            ++row;
            if (line.empty() || line[0] == '#') continue;
            try {
                const auto v = split_tabs(line);
                if (v.size() != 17) throw std::runtime_error("expected 17 tab-separated fields");
                Emitter e;
                e.level = integer(v[0]);
                if (e.level < 0 || e.level > 999) throw std::runtime_error("level out of range");
                e.preset = v[1];
                if (!known_preset(e.preset)) throw std::runtime_error("unknown preset");
                e.position = {
                    std::clamp(number(v[2]), -1000000.0f, 1000000.0f),
                    std::clamp(number(v[3]), -1000000.0f, 1000000.0f),
                    std::clamp(number(v[4]), -1000000.0f, 1000000.0f),
                };
                e.colour = {
                    std::clamp(number(v[5]), 0.0f, 4.0f),
                    std::clamp(number(v[6]), 0.0f, 4.0f),
                    std::clamp(number(v[7]), 0.0f, 4.0f),
                };
                e.alpha = std::clamp(number(v[8]), 0.0f, 1.0f);
                e.rate = std::clamp(number(v[9]), 0.0f, 120.0f);
                e.life = std::clamp(number(v[10]), 0.05f, 20.0f);
                e.size = std::clamp(number(v[11]), 0.01f, 50.0f);
                e.speed = std::clamp(number(v[12]), 0.0f, 100.0f);
                e.spread = std::clamp(number(v[13]), 0.0f, 20.0f);
                e.gravity = std::clamp(number(v[14]), -100.0f, 100.0f);
                e.haze_radius = std::clamp(number(v[15]), 0.0f, 100.0f);
                e.haze_strength = std::clamp(number(v[16]), 0.0f, 10.0f);
                out.push_back(std::move(e));
            } catch (const std::exception& error) {
                mod.warn("ignored " + file.filename().string() + " row " + std::to_string(row) + ": " + error.what());
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
            m_particles.clear();
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
                p.tint = {e.colour[0], e.colour[1], e.colour[2], e.alpha};
                p.blend = (e.preset == "smoke" || e.preset == "mist" || e.preset == "rain")
                    ? OPENRAC_PROP_ALPHA : OPENRAC_PROP_ADD;

                if (e.preset == "rain") {
                    p.position[0] += signed_random() * e.spread;
                    p.position[1] += signed_random() * e.spread;
                    p.position[2] += random01() * e.spread;
                    p.velocity = {signed_random() * 0.2f, signed_random() * 0.2f, -e.speed};
                } else if (e.preset == "smoke" || e.preset == "mist") {
                    p.velocity = {signed_random() * e.spread, signed_random() * e.spread,
                                  e.speed * (0.5f + random01())};
                    p.grow = e.preset == "smoke" ? e.size * 0.7f : e.size * 0.25f;
                } else if (e.preset == "glow") {
                    p.position[0] += signed_random() * e.spread;
                    p.position[1] += signed_random() * e.spread;
                    p.position[2] += signed_random() * e.spread;
                    p.velocity = {signed_random() * e.speed, signed_random() * e.speed, signed_random() * e.speed};
                } else {
                    p.velocity = {signed_random() * e.spread, signed_random() * e.spread,
                                  e.speed * (0.35f + random01())};
                }
                p.velocity[2] += e.gravity * 0.02f;
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
            p.velocity[2] -= 3.5f * dt;
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

OPENRAC_MOD_CPP("graphics-effects-runtime", "0.1.1", load)
