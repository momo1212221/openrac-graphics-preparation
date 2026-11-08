// SPDX-License-Identifier: GPL-3.0-or-later
import {upscaleAiPng} from "../src/ai-runtime.js";
import {readFailSafe} from "../src/resilience.js";

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const blobUrl=(bytes)=>URL.createObjectURL(new Blob([bytes],{type:"image/png"}));

export class QualityLab{
  constructor(controller,getSettings,setMessage){
    this.controller=controller;this.getSettings=getSettings;this.setMessage=setMessage;
    this.textures=[];this.selected="";this.preview=null;this.urls=[];this.overrides={};
  }
  async start(){
    this.overrides=await this.controller.storeGet("quality-overrides-v1").catch(()=>null)||{};
  }
  setTextures(textures){
    this.textures=textures||[];
    if(!this.textures.some(t=>t.path===this.selected))this.selected=this.textures[0]?.path||"";
  }
  getOverride(hash){return this.overrides[hash]||{}}
  async setOverride(hash,key,value){
    const next={...(this.overrides[hash]||{})};
    if(!value||value==="auto")delete next[key];else next[key]=value;
    if(Object.keys(next).length)this.overrides[hash]=next;else delete this.overrides[hash];
    await this.controller.storeSet("quality-overrides-v1",this.overrides);
  }
  clearUrls(){for(const url of this.urls)URL.revokeObjectURL(url);this.urls=[]}
  async run(){
    const texture=this.textures.find(t=>t.path===this.selected);
    if(!texture)return;
    this.setMessage(`Quality Lab: processing ${texture.hash}…`);
    try{
      const read=await readFailSafe(()=>this.controller.read("dump",texture.path),2);
      const source=read.bytes;
      const state=this.getSettings();
      const override=this.getOverride(texture.hash);
      const result=await upscaleAiPng(source,{
        mode:state.aiMode,detailQuality:state.detailQuality,detailCnn:state.detailCnn,
        sourceColorLock:state.sourceColorLock,preserveMicrodetail:state.preserveMicrodetail,
        preserveStars:state.preserveStars,backend:state.aiBackend,texturePaths:[texture.path],
        textureClassOverride:override.textureClass,materialOverride:override.material,
      });
      this.clearUrls();
      const original=blobUrl(source),output=blobUrl(result.bytes);this.urls.push(original,output);
      this.preview={texture,original,output,result};
      this.setMessage(`Preview ready · ${result.textureClass}/${result.material} · quality ${result.metrics?.score??"n/a"}/100`);
      document.dispatchEvent(new CustomEvent("graphics-quality-lab-change"));
    }catch(error){this.setMessage(error instanceof Error?error.message:String(error),true)}
  }
  render(){
    const section=el("section",undefined,"panel");
    section.append(el("div","QUALITY LAB","eyebrow"));
    section.append(el("p","Preview a source before exporting the full pack. Classification and material overrides are stored per texture hash.","muted"));
    if(!this.textures.length){section.append(el("p","No dumped textures are available.","info-note"));return section}

    const controls=el("div",undefined,"quality-controls");
    const select=document.createElement("select");select.className="select quality-select";
    for(const t of this.textures){const o=document.createElement("option");o.value=t.path;o.textContent=`${t.path} · ${t.hash}`;select.append(o)}
    select.value=this.selected;select.onchange=()=>{this.selected=select.value;this.preview=null;document.dispatchEvent(new CustomEvent("graphics-quality-lab-change"))};
    controls.append(select);
    const button=el("button","Preview selected","primary");button.onclick=()=>void this.run();controls.append(button);
    section.append(controls);

    const texture=this.textures.find(t=>t.path===this.selected);
    if(texture){
      const override=this.getOverride(texture.hash);
      const overrides=el("div",undefined,"quality-overrides");
      const make=(label,value,rows,key)=>{
        const wrap=el("label",undefined,"quality-field");wrap.append(el("span",label));
        const s=document.createElement("select");
        for(const [v,name] of rows){const o=document.createElement("option");o.value=v;o.textContent=name;s.append(o)}
        s.value=value||"auto";s.onchange=async()=>{await this.setOverride(texture.hash,key,s.value);this.preview=null;document.dispatchEvent(new CustomEvent("graphics-quality-lab-change"))};
        wrap.append(s);return wrap;
      };
      overrides.append(
        make("Texture class",override.textureClass,[["auto","Auto"],["diffuse","Diffuse"],["sky","Sky"],["ui","UI"],["normal","Normal"],["mask","Mask"]],"textureClass"),
        make("Material",override.material,[["auto","Auto"],["generic","Generic"],["weapon","Weapon"],["character","Character"],["terrain","Terrain"],["stone","Stone"],["metal","Metal"],["fabric","Fabric"],["organic","Organic"],["glass","Glass"],["energy","Energy"],["sky","Sky"]],"material"),
      );
      section.append(overrides);
    }

    if(this.preview){
      const view=el("div",undefined,"quality-preview");
      const before=el("figure");const bi=document.createElement("img");bi.src=this.preview.original;bi.alt="Original texture";before.append(bi,el("figcaption","Original"));
      const after=el("figure");const ai=document.createElement("img");ai.src=this.preview.output;ai.alt="AI texture";after.append(ai,el("figcaption","AI output"));
      view.append(before,after);section.append(view);
      const r=this.preview.result,m=r.metrics||{};
      const facts=el("div",undefined,"quality-facts");
      for(const [name,value] of [
        ["Class",r.textureClass],["Material",r.material],["Quality",m.score!==undefined?`${m.score}/100`:"n/a"],
        ["CNN agreement",m.cnnAgreement??"n/a"],["Colour drift",m.colorDrift??"n/a"],["Edge gain",m.edgeGain??"n/a"],
        ["Detail pixels",r.detailPixels??0],["Backend",r.backend],
      ]){const card=el("div",undefined,"quality-fact");card.append(el("span",name),el("strong",String(value)));facts.append(card)}
      section.append(facts);
    }
    return section;
  }
}
