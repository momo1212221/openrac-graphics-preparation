// SPDX-License-Identifier: GPL-3.0-or-later
#include "config.h"
#include "plugin_list.h"
#include <cassert>
#include <cmath>
#include <stdexcept>
#include <string>
using graphics_effects::parse_emitter_line;
static bool throws(const std::string& text){try{(void)parse_emitter_line(text);return false;}catch(const std::exception&){return true;}    {
        const auto ids=graphics_effects::parse_active_plugin_ids(
            R"({"format":1,"mods":[{"id":"graphics-preparation","enabled":true,"settings":{"nested":[1,{"x":"y"}]}},{"id":"fx-off","enabled":false},{"id":"fx-on","enabled":true},{"id":"fx-on","enabled":true}]})"
        );
        assert(ids.size()==2 && ids[0]=="graphics-preparation" && ids[1]=="fx-on");
        bool bad=false;
        try { (void)graphics_effects::parse_active_plugin_ids(R"({"format":1,"mods":[{"id":"../escape","enabled":true}]})"); }
        catch (const std::exception&) { bad=true; }
        assert(bad);
        bad=false;
        try { (void)graphics_effects::parse_active_plugin_ids("{broken"); }
        catch (const std::exception&) { bad=true; }
        assert(bad);
    }
}
static std::string row(const std::string& preset){return "2\t"+preset+"\t1\t2\t3\t1\t0.5\t0.2\t0.8\t12\t1.5\t0.2\t4\t1\t-3\t2\t0.4";}
int main(){
 for(const char* p:{"sparks","smoke","smog","mist","glow","energy","rain","heat-haze"}){auto e=parse_emitter_line(row(p));assert(e.level==2);assert(e.preset==p);assert(std::abs(e.position[2]-3.0f)<1e-6f);}
 assert(throws("2\tunknown\t1\t2\t3\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1"));
 assert(throws("1000\tsmoke\t1\t2\t3\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1"));
 assert(throws("2\tsmoke\tnan\t2\t3\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1\t1"));
 assert(throws("2\tsmoke\t1\t2"));
 auto x=parse_emitter_line("2\tsmog\t2000000\t-2000000\t3\t9\t-1\t2\t9\t999\t99\t99\t999\t99\t-999\t999\t999");
 assert(x.position[0]==1000000.0f&&x.position[1]==-1000000.0f); assert(x.colour[0]==4.0f&&x.colour[1]==0.0f);
 assert(x.alpha==1.0f&&x.rate==120.0f&&x.life==20.0f&&x.size==50.0f&&x.speed==100.0f&&x.spread==20.0f&&x.gravity==-100.0f&&x.haze_radius==100.0f&&x.haze_strength==10.0f);
}
