// SPDX-License-Identifier: GPL-3.0-or-later
import {upscaleAiMasterPng} from "../src/ai-runtime.js";
import {readFailSafe} from "../src/resilience.js";
import {upscalePng} from "../src/upscale.js";
import {generateMaterialMapPngs} from "../src/material-maps.js";
import {evaluateQuality} from "../src/quality-policy.js";
import {automaticDetailQuality,refinedDetailQuality} from "../src/quality-planner.js";

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
      const detailQuality=["standard","high","max"].includes(override.quality)
        ? override.quality : automaticDetailQuality(texture,state.detailQuality);
      const result=override.quality==="no-ai"
        ? {
            bytes:await upscalePng(source,4,true),backend:"no-ai",textureClass:override.textureClass||"manual",
            material:override.material||"manual",detailQuality:"no-ai",detailPixels:0,metrics:null,
          }
        : await upscaleAiMasterPng(source,{
            mode:state.aiMode,detailQuality,detailCnn:state.detailCnn,
            sourceColorLock:state.sourceColorLock,master8x:state.master8x,preserveMicrodetail:state.preserveMicrodetail,
            preserveStars:state.preserveStars,backend:state.aiBackend,texturePaths:[texture.path],
            textureClassOverride:override.textureClass,materialOverride:override.material,
          });
      let finalResult=result;
      if(state.detailQuality==="auto"&&!override.quality&&override.quality!=="no-ai"&&result.metrics){
        const refinedQuality=refinedDetailQuality(result,detailQuality);
        if(refinedQuality!==detailQuality){
          try{
            const refined=await upscaleAiMasterPng(source,{
              mode:state.aiMode,detailQuality:refinedQuality,detailCnn:state.detailCnn,
              sourceColorLock:state.sourceColorLock,master8x:state.master8x,preserveMicrodetail:state.preserveMicrodetail,
              preserveStars:state.preserveStars,backend:state.aiBackend,texturePaths:[texture.path],
              textureClassOverride:override.textureClass,materialOverride:override.material,
            });
            if(refinedQuality==="max"
              ? (refined.metrics?.score??0)>=(result.metrics?.score??0)-2
              : (refined.metrics?.score??-1)>(result.metrics?.score??-1)+1){
              finalResult=refined;
            }
          }catch{}
        }
      }
      this.clearUrls();
      const resultToShow=finalResult;
      const original=blobUrl(source),output=blobUrl(resultToShow.bytes);this.urls.push(original,output);
      let materialMaps=null;
      let materialPbr=null;
      if(resultToShow.textureClass==="diffuse"&&resultToShow.material&&resultToShow.material!=="manual"){
        try{
          const generated=await generateMaterialMapPngs(resultToShow.bytes,resultToShow.material,{curvature:state.materialCurvature!==false});
          materialMaps={};
          materialPbr={
            calibration:generated.pbrCalibration,validation:generated.pbrValidation,
            heightPipeline:generated.heightPipeline,
            quality:generated.quality,
            albedoDelight:generated.albedoDelight,albedoValidation:generated.albedoValidation,
          };
          for(const name of ["albedo","coarseHeight","midHeight","microHeight","height","normal","roughness","ao","emissive","specular","metallic","cavity","curvature","edgewear"]){
            if(!generated[name])continue;
            materialMaps[name]=blobUrl(generated[name]);this.urls.push(materialMaps[name]);
          }
        }catch{}
      }
      this.preview={texture,original,output,result:resultToShow,materialMaps,materialPbr,plannedQuality:detailQuality};
      this.setMessage(`Preview ready · ${resultToShow.textureClass}/${resultToShow.material} · ${resultToShow.detailQuality} · quality ${resultToShow.metrics?.score??"n/a"}/100`);
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
        make("Per-texture quality",override.quality,[["auto","Auto/global"],["standard","Current"],["high","High"],["max","Max"],["no-ai","No AI"]],"quality"),
      );
      section.append(overrides);
    }

    if(this.preview){
      const view=el("div",undefined,"quality-preview");
      const before=el("figure");const bi=document.createElement("img");bi.src=this.preview.original;bi.alt="Original texture";before.append(bi,el("figcaption","Original"));
      const after=el("figure");const ai=document.createElement("img");ai.src=this.preview.output;ai.alt="AI texture";after.append(ai,el("figcaption","AI output"));
      view.append(before,after);section.append(view);
      if(this.preview.materialMaps){
        const maps=el("div",undefined,"quality-material-maps");
        for(const name of ["albedo","coarseHeight","midHeight","microHeight","height","normal","roughness","ao","emissive","specular","metallic","cavity","curvature","edgewear"]){
          if(!this.preview.materialMaps[name])continue;
          const figure=el("figure");const image=document.createElement("img");
          image.src=this.preview.materialMaps[name];image.alt=name+" material map";
          figure.append(image,el("figcaption",name[0].toUpperCase()+name.slice(1)));maps.append(figure);
        }
        section.append(maps);
      }
      const r=this.preview.result,m=r.metrics||{};
      const policy=evaluateQuality(m,r);
      const facts=el("div",undefined,"quality-facts");
      for(const [name,value] of [
        ["Class",r.textureClass],["Material",r.material],["Planned",this.preview.plannedQuality],["Used",r.detailQuality],["Target",policy.targetScore!==undefined?`${policy.targetScore}/100`:"n/a"],["Quality",m.score!==undefined?`${m.score}/100`:"n/a"],
        ["Master",r.internalMaster?"8× → 4×":"4×"],["CNN agreement",m.cnnAgreement??"n/a"],["CNN confidence",m.cnnConfidence??"n/a"],["Confidence P10",m.cnnConfidenceP10??"n/a"],["Regional low confidence",m.cnnLowConfidenceRatio!==undefined?Math.round(m.cnnLowConfidenceRatio*100)+"%":"n/a"],["SSIM",m.ssim??"n/a"],["Colour drift",m.colorDrift??"n/a"],["Histogram drift",m.histogramDrift??"n/a"],["Edge gain",m.edgeGain??"n/a"],["Hallucination",m.hallucinationScore??"n/a"],["Alpha coverage",r.alphaEdges?.hasTransparency?Math.round((r.alphaEdges.coverageAfter??0)*100)+"%":"opaque"],["Alpha edge error",m.alphaEdgeCoverageDiff!==undefined?m.alphaEdgeCoverageDiff+"%":"n/a"],["Alpha edge pixels",r.alphaEdges?.edgePixels??0],
        ["PBR validation",this.preview.materialPbr?.validation?.ok===true?"pass":(this.preview.materialPbr?.validation?.ok===false?"review":"n/a")],
        ["Mean roughness",this.preview.materialPbr?.calibration?.meanRoughness??"n/a"],
        ["Mean metallic",this.preview.materialPbr?.calibration?.meanMetallic??"n/a"],
        ["Mean specular",this.preview.materialPbr?.calibration?.meanSpecular??"n/a"],
        ["Albedo de-light",this.preview.materialPbr?.albedoValidation?.ok===true?"pass":(this.preview.materialPbr?.albedoValidation?.ok===false?"review":"n/a")],
        ["Albedo adjusted",this.preview.materialPbr?.albedoDelight?.adjustedRatio!==undefined?Math.round(this.preview.materialPbr.albedoDelight.adjustedRatio*100)+"%":"n/a"],
        ["Height source",this.preview.materialPbr?.heightPipeline?"de-lit albedo":"n/a"],
        ["Pipeline version",this.preview.materialPbr?.heightPipeline?.version??"n/a"],
        ["Pipeline validation",this.preview.materialPbr?.quality?.heightPipelineValidation?.ok===true?"pass":(this.preview.materialPbr?.quality?.heightPipelineValidation?.ok===false?"review":"n/a")],
        ["Relief range",this.preview.materialPbr?.heightPipeline?.merged?.reliefRange??"n/a"],
        ["Normal strength",this.preview.materialPbr?.heightPipeline?.profile?.normalStrength??"n/a"],
        ["Coarse energy",this.preview.materialPbr?.heightPipeline?.bands?.coarse?.meanAbs??"n/a"],
        ["Mid energy",this.preview.materialPbr?.heightPipeline?.bands?.mid?.meanAbs??"n/a"],
        ["Micro energy",this.preview.materialPbr?.heightPipeline?.bands?.micro?.meanAbs??"n/a"],
        ["Curvature",this.preview.materialPbr?.heightPipeline?.curvatureEnabled===true?"on":(this.preview.materialPbr?.heightPipeline?"off":"n/a")],
        ["Normal mean tilt",this.preview.materialPbr?.quality?.normalTilt?.meanDeg!==undefined?this.preview.materialPbr.quality.normalTilt.meanDeg+"°":"n/a"],
        ["Normal P95 tilt",this.preview.materialPbr?.quality?.normalTilt?.p95Deg!==undefined?this.preview.materialPbr.quality.normalTilt.p95Deg+"°":"n/a"],
        ["Steep normals",this.preview.materialPbr?.quality?.normalTilt?.steepPercent!==undefined?this.preview.materialPbr.quality.normalTilt.steepPercent+"%":"n/a"],
        ["Height relief QA",this.preview.materialPbr?.quality?.heightRelief?.range??"n/a"],
        ["Relief warnings",this.preview.materialPbr?.quality?.reliefWarnings?.join(", ")||"none"],
        ["Parallax-ready",this.preview.materialPbr?.heightPipeline?.parallaxAuthoring?.ready===true?"yes":(this.preview.materialPbr?.heightPipeline?"no":"n/a")],
        ["Parallax scale hint",this.preview.materialPbr?.heightPipeline?.parallaxAuthoring?.recommendedScale??"n/a"],
        ["Verdict",policy.verdict],["Specialized CNN",r.specializedCnnUsed?"used":(r.specializedRejected?"rejected":"none")],["Failures",r.failures?.issues?.join(", ")||"none"],["Recommended",policy.recommendedQuality??"keep"],["Detail pixels",r.detailPixels??0],["Backend",r.backend],
      ]){const card=el("div",undefined,"quality-fact");card.append(el("span",name),el("strong",String(value)));facts.append(card)}
      section.append(facts);
    }
    return section;
  }
}
