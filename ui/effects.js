// SPDX-License-Identifier: GPL-3.0-or-later
import {
  DEFAULT_EFFECTS, bakerExportIssues, bakerSettingsForLevel, effectExportIssues, normalizeEffects, normalizeLight, normalizeAreaLight, normalizeParticle,
  setBakerSettingsForLevel, loadLevels, readProbeProfile, exportBakerProfile, exportEffectsMod,
} from "../src/effects-authoring.js";

const node=(tag,text,cls)=>{
  const n=document.createElement(tag);
  if(text!==undefined)n.textContent=text;
  if(cls)n.className=cls;
  return n;
};
const field=(label,value,onchange,{type="number",step="0.1",min,max}={})=>{
  const wrap=node("label",undefined,"effect-field");
  wrap.append(node("span",label));
  const input=document.createElement("input");
  input.type=type;
  input.value=String(value);
  if(type==="number"){input.step=step;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max}
  input.onchange=()=>{
    if(type!=="number"){onchange(input.value);return}
    const next=input.valueAsNumber;
    if(!Number.isFinite(next)){input.value=String(value);return}
    onchange(next);
  };
  wrap.append(input);return wrap;
};
const toggleField=(label,value,onchange)=>{
  const wrap=node("label",undefined,"effect-field effect-toggle");
  wrap.append(node("span",label));
  const input=document.createElement("input"); input.type="checkbox"; input.checked=Boolean(value);
  input.onchange=()=>onchange(input.checked); wrap.append(input); return wrap;
};
const vecFields=(title,value,onchange)=>{
  const wrap=node("div",undefined,"effect-vector");
  wrap.append(node("span",title,"effect-vector-title"));
  ["X","Y","Z"].forEach((axis,i)=>wrap.append(field(axis,value[i],v=>{const next=[...value];next[i]=v;onchange(next)},{step:"0.1"})));
  return wrap;
};
const selectField=(label,value,rows,onchange)=>{
  const wrap=node("label",undefined,"effect-field");
  wrap.append(node("span",label));
  const input=document.createElement("select");
  for(const [v,text] of rows){const o=document.createElement("option");o.value=v;o.textContent=text;input.append(o)}
  input.value=value;input.disabled=!rows.length;input.onchange=()=>onchange(input.value);wrap.append(input);return wrap;
};

export class EffectsEditor {
  constructor(controller,info,setMessage){
    this.controller=controller;this.info=info;this.setMessage=setMessage;
    this.state=normalizeEffects(DEFAULT_EFFECTS);this.levels=[];this.profile={};this.profileError="";this.positionClipboard=null;
  }
  async start(){
    const [levels,saved]=await Promise.all([
      loadLevels(this.controller),
      this.controller.storeGet("effects-authoring-v1").catch(()=>null),
    ]);
    this.levels=levels;
    this.state=normalizeEffects(saved||DEFAULT_EFFECTS);
    if(!this.levels.some(l=>l.dir===this.state.selectedLevel))this.state.selectedLevel=this.levels[0]?.dir||"";
    const level=this.currentLevel();
    if(!level?.objects.some(o=>o.key===this.state.selectedObject))this.state.selectedObject=level?.objects[0]?.key||"";
    if(!level?.placements?.some(o=>o.key===this.state.selectedPlacement))this.state.selectedPlacement=level?.placements?.[0]?.key||"";
    await this.loadProfile(this.state.selectedLevel);
    await this.persist();
  }
  currentLevel(){return this.levels.find(l=>l.dir===this.state.selectedLevel)}
  async loadProfile(dir){
    this.profileError="";
    try{
      this.profile=await readProbeProfile(this.controller,dir);
    }catch(error){
      this.profile={};
      this.profileError=error instanceof Error?error.message:String(error);
      this.setMessage(this.profileError,true);
    }
    this.state.baker=bakerSettingsForLevel(this.state,dir,this.profile);
  }
  selectedPlacementInstance(){
    return this.currentLevel()?.placements?.find((row)=>row.key===this.state.selectedPlacement)||null;
  }
  async persist(){await this.controller.storeSet("effects-authoring-v1",this.state)}
  async placeParticleAtInstance(particle){
    const anchor=this.selectedPlacementInstance();
    if(!anchor?.position){
      this.setMessage("No exported level instance is selected. Enter X/Y/Z manually or select an instance from placements.json.",true);
      return;
    }
    particle.position=[...anchor.position];
    particle.placement="object";
    particle.anchorObject=anchor.key;
    await this.persist();
    document.dispatchEvent(new CustomEvent("graphics-effects-change"));
    this.setMessage(`Placed ${particle.preset} at ${anchor.label} · X ${particle.position[0]} · Y ${particle.position[1]} · Z ${particle.position[2]}`);
  }
  async setParticlePosition(particle,position){
    const next=Array.isArray(position)?position.slice(0,3).map(Number):[];
    if(next.length!==3||!next.every(Number.isFinite)){
      this.setMessage("Effect placement needs finite X/Y/Z coordinates.",true);
      return;
    }
    particle.position=next;
    particle.placement="manual";
    particle.anchorObject="";
    await this.persist();
    document.dispatchEvent(new CustomEvent("graphics-effects-change"));
  }
  async chooseLevel(dir){
    this.state.selectedLevel=dir;
    const level=this.currentLevel();
    if(!level?.objects.some(o=>o.key===this.state.selectedObject))this.state.selectedObject=level?.objects[0]?.key||"";
    if(!level?.placements?.some(o=>o.key===this.state.selectedPlacement))this.state.selectedPlacement=level?.placements?.[0]?.key||"";
    await this.loadProfile(dir);
    await this.persist();
    document.dispatchEvent(new CustomEvent("graphics-effects-change"));
  }
  async updateBaker(key,value){
    setBakerSettingsForLevel(this.state,this.state.selectedLevel,{...this.state.baker,[key]:value});
    await this.persist(); document.dispatchEvent(new CustomEvent("graphics-effects-change"));
  }
  async placeAreaAtInstance(area){
    const anchor=this.selectedPlacementInstance();
    if(!anchor?.position){this.setMessage("No exported level instance is selected. Enter X/Y/Z manually or select an instance from placements.json.",true);return}
    area.position=[...anchor.position]; area.placement="object"; area.anchorObject=anchor.key;
    await this.persist(); document.dispatchEvent(new CustomEvent("graphics-effects-change"));
  }
  async setAreaPosition(area,position){
    const next=Array.isArray(position)?position.slice(0,3).map(Number):[];
    if(next.length!==3||!next.every(Number.isFinite)){this.setMessage("Area-light placement needs finite X/Y/Z coordinates.",true);return}
    area.position=next; area.placement="manual"; area.anchorObject="";
    await this.persist(); document.dispatchEvent(new CustomEvent("graphics-effects-change"));
  }
  addLight(type){
    this.state.lights.push(normalizeLight({object:this.state.selectedObject,type,name:type==="spot"?"Spot light":"Point light"}));
    void this.persist();document.dispatchEvent(new CustomEvent("graphics-effects-change"));
  }
  addArea(){
    this.state.areaLights.push(normalizeAreaLight({level:this.state.selectedLevel,placement:"unplaced"}));
    void this.persist();document.dispatchEvent(new CustomEvent("graphics-effects-change"));
  }
  addParticle(preset){
    const presets={
      sparks:{preset:"sparks",colour:[1,0.45,0.08],rate:18,life:0.9,size:0.12,speed:6,spread:2,gravity:-8},
      smoke:{preset:"smoke",colour:[0.55,0.55,0.55],alpha:0.45,rate:5,life:3,size:0.6,speed:0.9,spread:0.5,gravity:0.25},
      smog:{preset:"smog",colour:[0.48,0.46,0.42],alpha:0.24,rate:3,life:6,size:1.4,speed:0.2,spread:1.2,gravity:0},
      mist:{preset:"mist",colour:[0.7,0.85,1],alpha:0.2,rate:4,life:4,size:1.1,speed:0.35,spread:0.8,gravity:0},
      glow:{preset:"glow",colour:[0.2,0.65,1],alpha:0.8,rate:2,life:1.2,size:0.28,speed:0.2,spread:0.2,gravity:0},
      energy:{preset:"energy",colour:[0.45,0.2,1],alpha:0.85,rate:14,life:1,size:0.15,speed:3,spread:1.2,gravity:0},
      rain:{preset:"rain",colour:[0.6,0.75,1],alpha:0.55,rate:45,life:1.5,size:0.05,speed:12,spread:5,gravity:-14},
      "heat-haze":{preset:"heat-haze",colour:[1,1,1],alpha:0,rate:0,life:1,size:0,speed:0,spread:0,gravity:0,hazeRadius:3,hazeStrength:0.35},
    };
    this.state.particles.push(normalizeParticle({
      level:this.state.selectedLevel,
      ...presets[preset],
      placement:"unplaced",
    }));
    void this.persist();document.dispatchEvent(new CustomEvent("graphics-effects-change"));
  }
  render(){
    const sections=[];
    const level=this.currentLevel();

    const lighting=node("section",undefined,"panel");
    lighting.append(node("div","LIGHTING & BAKER","eyebrow"));
    const top=node("div",undefined,"effect-grid two");
    top.append(selectField("Level",this.state.selectedLevel,this.levels.map(l=>[l.dir,`${l.dir} · level ${l.level}`]),v=>void this.chooseLevel(v)));
    top.append(selectField("Attach runtime light to",this.state.selectedObject,(level?.objects||[]).map(o=>[o.key,o.label]),async v=>{this.state.selectedObject=v;await this.persist()}));
    lighting.append(top);

    const baker=node("div",undefined,"effect-subpanel");
    baker.append(node("strong","Enhanced Baker · stock launcher"));
    baker.append(node("p","Edits the official probe-bake.json schema used by the normal OpenRAC Enhanced graphics baker. This mod does not patch or replace the launcher.","muted"));
    const bgrid=node("div",undefined,"effect-grid four");
    bgrid.append(field("Sky intensity",this.state.baker.skyIntensity,v=>void this.updateBaker("skyIntensity",v),{step:"0.05",min:"0",max:"1000000"}));
    bgrid.append(field("Sky weight",this.state.baker.skyWeight,v=>void this.updateBaker("skyWeight",v),{step:"0.05",min:"0",max:"1"}));
    bgrid.append(field("Surface emission",this.state.baker.surfaceEmissionScale,v=>void this.updateBaker("surfaceEmissionScale",v),{step:"0.1",min:"0",max:"1000000"}));
    bgrid.append(selectField("Probe resolution",String(this.state.baker.probeResolution),[4,8,16,32,64,128,256].map(v=>[String(v),String(v)]),v=>void this.updateBaker("probeResolution",Number(v))));
    bgrid.append(field("Maximum probes",this.state.baker.maximumProbes,v=>void this.updateBaker("maximumProbes",Math.round(v)),{step:"1",min:"1",max:"512"}));
    bgrid.append(field("Probe spacing",this.state.baker.spacing,v=>void this.updateBaker("spacing",v),{step:"1",min:"2",max:"1024"}));
    bgrid.append(field("Rays / probe",this.state.baker.rays,v=>void this.updateBaker("rays",Math.round(v)),{step:"16",min:"16",max:"1048576"}));
    bgrid.append(field("Bounces",this.state.baker.bounces,v=>void this.updateBaker("bounces",Math.round(v)),{step:"1",min:"0",max:"32"}));
    bgrid.append(toggleField("Adaptive rays",this.state.baker.adaptiveRays,v=>void this.updateBaker("adaptiveRays",v)));
    bgrid.append(toggleField("Environment probes",this.state.baker.environmentProbes,v=>void this.updateBaker("environmentProbes",v)));
    baker.append(bgrid);
    const bakerIssues=[...(this.profileError?[this.profileError]:[]),...bakerExportIssues(this.state,this.state.selectedLevel,this.profile)];
    if(bakerIssues.length)baker.append(node("p","Baker export blocked: "+bakerIssues.slice(0,3).join(" · ")+(bakerIssues.length>3?" · +"+(bakerIssues.length-3)+" more":""),"placement-warning"));
    lighting.append(baker);
    const buttons=node("div",undefined,"effect-actions");
    for(const [label,fn] of [["Add point light",()=>this.addLight("point")],["Add spot light",()=>this.addLight("spot")],["Add bake area light",()=>this.addArea()]]) {
      const b=node("button",label,"ghost");b.type="button";b.onclick=fn;buttons.append(b);
    }
    const exportBake=node("button","Export baker profile","primary");exportBake.type="button";
    exportBake.disabled=bakerIssues.length>0;exportBake.title=bakerIssues[0]||"Export a stock Enhanced graphics probe-bake.json profile.";
    exportBake.onclick=async()=>{
      try{
        const saved=await exportBakerProfile(this.controller,this.info,this.state,this.state.selectedLevel,this.profile);
        this.setMessage(saved?`Saved ${saved}. Save it directly inside the selected exported level folder with the exact name probe-bake.json, then use Enhanced graphics → Prepare lighting in the normal launcher.`:"Save cancelled.");
      }catch(e){this.setMessage(e instanceof Error?e.message:String(e),true)}
    };
    buttons.append(exportBake);lighting.append(buttons);
    lighting.append(this.renderLights());
    sections.push(lighting);

    const particles=node("section",undefined,"panel");
    particles.append(node("div","PARTICLES & EFFECTS","eyebrow"));
    particles.append(node("p","Runtime effects use the official OpenRAC prop/haze API. Pick a preset, then place it at X/Y/Z or snap it to a real tie/shrub/moby instance loaded from the level's placements.json.","muted"));
    const placementTop=node("div",undefined,"effect-placement-toolbar");
    const placementRows=(level?.placements||[]).map((row)=>[row.key,row.label]);
    placementTop.append(selectField(
      "Level instance",
      this.state.selectedPlacement,
      placementRows,
      async v=>{this.state.selectedPlacement=v;await this.persist();document.dispatchEvent(new CustomEvent("graphics-effects-change"))},
    ));
    const anchor=this.selectedPlacementInstance();
    placementTop.append(node(
      "p",
      anchor?.position
        ? `Instance position: X ${anchor.position[0]} · Y ${anchor.position[1]} · Z ${anchor.position[2]}`
        : "No placement instances were found for this exported level. Enter X/Y/Z manually.",
      anchor?.position?"placement-ready":"placement-note",
    ));
    particles.append(placementTop);
    const presets=node("div",undefined,"effect-actions wrap");
    for(const [id,label] of [["sparks","Sparks"],["smoke","Smoke"],["smog","Smog"],["mist","Mist"],["glow","Glow"],["energy","Energy"],["rain","Rain"],["heat-haze","Heat haze"]]) {
      const b=node("button","+ "+label,"ghost");b.type="button";b.onclick=()=>this.addParticle(id);presets.append(b);
    }
    particles.append(presets,this.renderParticles());
    const validLevelDirs=new Set(this.levels.map((row)=>row.dir));
    const orphaned=this.state.particles.filter((p)=>!validLevelDirs.has(p.level));
    if(orphaned.length){
      const orphanBox=node("div",undefined,"effect-orphans");
      orphanBox.append(node("strong",`${orphaned.length} effect${orphaned.length===1?"":"s"} reference unavailable levels`));
      orphanBox.append(node("p",orphaned.slice(0,4).map((p)=>`${p.preset} · ${p.level||"no level"}`).join(" · ")+(orphaned.length>4?` · +${orphaned.length-4} more`:""),"placement-note"));
      const remove=node("button","Remove unavailable effects","ghost");
      remove.type="button";
      remove.onclick=async()=>{
        this.state.particles=this.state.particles.filter((p)=>validLevelDirs.has(p.level));
        await this.persist();
        document.dispatchEvent(new CustomEvent("graphics-effects-change"));
        this.setMessage("Removed runtime effects that referenced unavailable levels.");
      };
      orphanBox.append(remove);
      particles.append(orphanBox);
    }
    const exportIssues=effectExportIssues(this.state,this.levels);
    if(exportIssues.length){
      const detail=exportIssues.slice(0,3).join(" · ")+(exportIssues.length>3?` · +${exportIssues.length-3} more`:"");
      particles.append(node("p",`Export blocked: ${detail}`,"placement-warning"));
    }
    const exportRuntime=node("button","Export runtime effects mod","primary effect-export");exportRuntime.type="button";
    exportRuntime.disabled=exportIssues.length>0;
    exportRuntime.title=exportIssues[0]||"Export placed runtime effects.";
    exportRuntime.onclick=async()=>{
      try{
        const saved=await exportEffectsMod(this.controller,this.info,this.state,this.levels);
        this.setMessage(saved?`Saved ${saved}. Install it through Mods → Add a mod. Runtime particles are handled by Graphics preparation itself; no second runtime install is needed. Point/spot lights use Enhanced graphics directly.`:"Save cancelled.");
      }catch(e){this.setMessage(e instanceof Error?e.message:String(e),true)}
    };
    particles.append(exportRuntime);
    sections.push(particles);

    const note=node("section",undefined,"panel");
    note.append(node("div","HOW IT APPLIES","eyebrow"));
    note.append(node("p","Point/spot lights are written to assets/level_NN/object-lights.json, which is the per-level asset root used by the standard Enhanced renderer. Area lights are bake-only and go into probe-bake.json. The current stock Mod Tool API can save that profile but cannot overwrite OpenRAC's extracted level folder or press Prepare lighting for you, so the final bake remains the built-in Enhanced graphics action.","info-note"));
    sections.push(note);
    return sections;
  }
  renderLights(){
    const wrap=node("div",undefined,"effect-list");
    if(!this.state.lights.length&&!this.state.areaLights.length){wrap.append(node("p","No authored lights yet.","muted"));return wrap}
    this.state.lights.forEach((light,index)=>{
      const card=node("div",undefined,"effect-card");
      const head=node("div",undefined,"effect-card-head");head.append(node("strong",`${light.type==="spot"?"Spot":"Point"} · ${light.object||"no object"}`));
      const del=node("button","Remove","ghost");del.onclick=async()=>{this.state.lights.splice(index,1);await this.persist();document.dispatchEvent(new CustomEvent("graphics-effects-change"))};head.append(del);card.append(head);
      card.append(vecFields("Position",light.position,async v=>{light.position=v;await this.persist()}));
      card.append(vecFields("Colour RGB",light.colour,async v=>{light.colour=v;await this.persist()}));
      const g=node("div",undefined,"effect-grid four");
      g.append(field("Intensity",light.intensity,async v=>{light.intensity=v;await this.persist()},{min:"0"}));
      g.append(field("Range",light.range,async v=>{light.range=v;await this.persist()},{min:"0.01",step:"0.01"}));
      if(light.type==="spot"){
        g.append(field("Inner angle",light.inner_angle,async v=>{light.inner_angle=v;await this.persist()},{step:"0.05",min:"0",max:"1.55"}));
        g.append(field("Outer angle",light.outer_angle,async v=>{light.outer_angle=v;await this.persist()},{step:"0.05",min:"0",max:"1.56"}));
        card.append(vecFields("Direction",light.direction,async v=>{light.direction=v;await this.persist()}));
      }
      card.append(g);wrap.append(card);
    });
    this.state.areaLights.filter(a=>a.level===this.state.selectedLevel).forEach((area)=>{
      const index=this.state.areaLights.indexOf(area);const card=node("div",undefined,"effect-card");
      const head=node("div",undefined,"effect-card-head");head.append(node("strong","Bake area light"));
      const del=node("button","Remove","ghost");del.onclick=async()=>{this.state.areaLights.splice(index,1);await this.persist();document.dispatchEvent(new CustomEvent("graphics-effects-change"))};head.append(del);card.append(head);
      const status=area.placement==="unplaced"?"Needs placement":area.placement==="object"?`Placed at ${area.anchorObject||"level instance"}`:"Manual X/Y/Z confirmed";
      card.append(node("p",status,area.placement==="unplaced"?"placement-warning":"placement-ready"));
      const actions=node("div",undefined,"effect-actions wrap");
      const snap=node("button","Place at selected level instance","ghost");snap.type="button";snap.onclick=()=>void this.placeAreaAtInstance(area);actions.append(snap);
      const confirm=node("button","Confirm X/Y/Z","ghost");confirm.type="button";confirm.onclick=()=>void this.setAreaPosition(area,area.position);actions.append(confirm);
      const clear=node("button","Clear placement","ghost");clear.type="button";clear.onclick=async()=>{area.placement="unplaced";area.anchorObject="";await this.persist();document.dispatchEvent(new CustomEvent("graphics-effects-change"))};actions.append(clear);
      card.append(actions);
      card.append(vecFields("Position",area.position,v=>void this.setAreaPosition(area,v)));
      card.append(vecFields("Half-edge U",area.axis_u,async v=>{area.axis_u=v;await this.persist()}));
      card.append(vecFields("Half-edge V",area.axis_v,async v=>{area.axis_v=v;await this.persist()}));
      card.append(vecFields("Radiance RGB",area.radiance,async v=>{area.radiance=v;await this.persist()}));
      wrap.append(card);
    });
    return wrap;
  }
  renderParticles(){
    const wrap=node("div",undefined,"effect-list");
    const rows=this.state.particles.filter(p=>p.level===this.state.selectedLevel);
    if(!rows.length){wrap.append(node("p","No effects on this level yet.","muted"));return wrap}
    rows.forEach((p)=>{
      const index=this.state.particles.indexOf(p);const card=node("div",undefined,"effect-card");
      const head=node("div",undefined,"effect-card-head");head.append(node("strong",p.preset));
      const del=node("button","Remove","ghost");del.onclick=async()=>{this.state.particles.splice(index,1);await this.persist();document.dispatchEvent(new CustomEvent("graphics-effects-change"))};head.append(del);card.append(head);
      const placement=node("div",undefined,"effect-placement");
      const placementHead=node("div",undefined,"effect-placement-head");
      placementHead.append(node("strong","Placement"));
      const placed=p.placement!=="unplaced";
      placementHead.append(node(
        "span",
        placed?(p.placement==="object"?"Placed · level instance":"Placed · manual"):"Needs placement",
        placed?"status-ok":"status-warn",
      ));
      placement.append(placementHead);
      placement.append(vecFields("World position",p.position,async v=>this.setParticlePosition(p,v)));
      const placementActions=node("div",undefined,"effect-actions wrap placement-actions");
      const anchor=this.selectedPlacementInstance();
      const placeObject=node("button","Place at selected level instance","ghost");
      placeObject.type="button";
      placeObject.disabled=!anchor?.position;
      placeObject.title=anchor?.position?"Use the selected placements.json instance world position.":"No exported placement instance is selected.";
      placeObject.onclick=()=>void this.placeParticleAtInstance(p);
      placementActions.append(placeObject);

      const confirm=node("button","Confirm X/Y/Z","ghost");
      confirm.type="button";
      confirm.onclick=()=>void this.setParticlePosition(p,p.position);
      placementActions.append(confirm);

      const copy=node("button","Copy position","ghost");
      copy.type="button";
      copy.onclick=()=>{
        this.positionClipboard=[...p.position];
        this.setMessage(`Copied effect position X ${p.position[0]} · Y ${p.position[1]} · Z ${p.position[2]}`);
        document.dispatchEvent(new CustomEvent("graphics-effects-change"));
      };
      placementActions.append(copy);

      const paste=node("button","Paste position","ghost");
      paste.type="button";
      paste.disabled=!this.positionClipboard;
      paste.onclick=()=>this.positionClipboard&&void this.setParticlePosition(p,this.positionClipboard);
      placementActions.append(paste);

      const player=node("button","Use player position","ghost placement-unavailable");
      player.type="button";
      player.disabled=true;
      player.title="The current stock OpenRAC Mod Tool protocol does not expose the live player position.";
      placementActions.append(player);

      const clear=node("button","Clear placement","ghost");
      clear.type="button";
      clear.onclick=async()=>{p.position=[0,0,0];p.placement="unplaced";p.anchorObject="";await this.persist();document.dispatchEvent(new CustomEvent("graphics-effects-change"))};
      placementActions.append(clear);
      placement.append(placementActions);
      if(p.placement==="object"&&p.anchorObject){
        placement.append(node("p",`Source instance: ${p.anchorObject}. Its position is snapshotted as world coordinates in the exported runtime file; the effect does not follow a moving object.`,"placement-note"));
      }
      if(!placed){
        placement.append(node("p","This effect will not export until it has a valid placement.","placement-warning"));
      }
      card.append(placement);
      if(p.preset==="heat-haze"){
        const g=node("div",undefined,"effect-grid two");
        g.append(field("Radius",p.hazeRadius,async v=>{p.hazeRadius=v;await this.persist()},{min:"0"}));
        g.append(field("Strength",p.hazeStrength,async v=>{p.hazeStrength=v;await this.persist()},{min:"0"}));card.append(g);
      }else{
        card.append(vecFields("Colour RGB",p.colour,async v=>{p.colour=v;await this.persist()}));
        const g=node("div",undefined,"effect-grid four");
        for(const [label,key,min] of [["Rate","rate","0"],["Life","life","0.05"],["Size","size","0.01"],["Speed","speed","0"],["Spread","spread","0"],["Gravity","gravity",undefined],["Alpha","alpha","0"]]){
          g.append(field(label,p[key],async v=>{p[key]=v;await this.persist()},{step:"0.1",min,max:key==="alpha"?"1":undefined}));
        }
        card.append(g);
      }
      wrap.append(card);
    });
    return wrap;
  }
}
