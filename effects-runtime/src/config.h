// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

namespace graphics_effects {
struct Emitter {
    int level = -1;
    std::string preset;
    std::array<float, 3> position{};
    std::array<float, 3> colour{1, 1, 1};
    float alpha = 1, rate = 0, life = 1, size = 0.1f, speed = 1, spread = 1, gravity = 0;
    float haze_radius = 0, haze_strength = 0, spawn = 0;
};
inline std::vector<std::string> split_tabs(const std::string& line) {
    std::vector<std::string> out; std::size_t at = 0;
    while (true) { const auto next=line.find('\t',at); out.push_back(line.substr(at,next==std::string::npos?next:next-at)); if(next==std::string::npos)break; at=next+1; }
    return out;
}
inline float number(const std::string& text) {
    std::size_t used=0; const float value=std::stof(text,&used);
    if(used!=text.size()||!std::isfinite(value))throw std::runtime_error("invalid number"); return value;
}
inline int integer(const std::string& text) {
    std::size_t used=0; const int value=std::stoi(text,&used);
    if(used!=text.size())throw std::runtime_error("invalid integer"); return value;
}
inline bool known_preset(const std::string& preset) {
    return preset=="sparks"||preset=="smoke"||preset=="smog"||preset=="mist"||preset=="glow"||preset=="energy"||preset=="rain"||preset=="heat-haze";
}
inline Emitter parse_emitter_line(const std::string& line) {
    const auto v=split_tabs(line); if(v.size()!=17)throw std::runtime_error("expected 17 tab-separated fields");
    Emitter e; e.level=integer(v[0]); if(e.level<0||e.level>999)throw std::runtime_error("level out of range");
    e.preset=v[1]; if(!known_preset(e.preset))throw std::runtime_error("unknown preset");
    e.position={std::clamp(number(v[2]),-1000000.0f,1000000.0f),std::clamp(number(v[3]),-1000000.0f,1000000.0f),std::clamp(number(v[4]),-1000000.0f,1000000.0f)};
    e.colour={std::clamp(number(v[5]),0.0f,4.0f),std::clamp(number(v[6]),0.0f,4.0f),std::clamp(number(v[7]),0.0f,4.0f)};
    e.alpha=std::clamp(number(v[8]),0.0f,1.0f); e.rate=std::clamp(number(v[9]),0.0f,120.0f);
    e.life=std::clamp(number(v[10]),0.05f,20.0f); e.size=std::clamp(number(v[11]),0.01f,50.0f);
    e.speed=std::clamp(number(v[12]),0.0f,100.0f); e.spread=std::clamp(number(v[13]),0.0f,20.0f);
    e.gravity=std::clamp(number(v[14]),-100.0f,100.0f); e.haze_radius=std::clamp(number(v[15]),0.0f,100.0f); e.haze_strength=std::clamp(number(v[16]),0.0f,10.0f);
    return e;
}
} // namespace graphics_effects
