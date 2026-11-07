// SPDX-License-Identifier: GPL-3.0-or-later
import {request, service} from './bridge.js';
import {ModController} from '../src/controller.js';
const mod=new ModController(service), content=document.querySelector('#content'), message=document.querySelector('#message'), enabled=document.querySelector('#enabled');
let running=false, current=null;
const el=(tag,text)=>{const e=document.createElement(tag); if(text!==undefined)e.textContent=text;return e;};
async function perform(fn){if(running)return;running=true;message.textContent='Working…';try{await fn(); message.textContent='Done.';}catch(e){message.textContent=e.message;}finally{running=false;await refresh(true);}}
function button(parent,text,op,value=null,disabled=false){const b=el('button',text);b.disabled=disabled;b.onclick=()=>perform(()=>mod.action(op,value));parent.append(b);}
function section(title,text){const s=el('section');s.append(el('h2',title),el('p',text));content.append(s);return s;}
function render(s){
 current=s;enabled.checked=s.enabled;enabled.disabled=running;content.replaceChildren();
 const bake=s.view.bake, off=!s.enabled||running;
 const lighting=section('Lighting, GI, water & clouds',`${bake.ready}/${bake.levels} levels ready · ${bake.partial} resumable · ${bake.failed} failed${bake.busy?' · running':''}`);
 if(bake.why)lighting.append(el('p',bake.why));
 button(lighting,bake.partial?'Resume preparation':'Prepare lighting','bake.start',null,off||bake.busy||!bake.available);
 button(lighting,'Stop my bake','bake.stop',null,!s.job||running);
 button(lighting,'Delete lighting cache…','bake.clear',null,off||bake.busy);
 const log=el('pre',s.log||'Bake output appears here. Full job output is also available in the launcher Tasks page.');lighting.append(log);
 const textures=section('Offline assets','Ultra textures are generated before play. AI enhancement needs the separately installed NCNN backend. Original collision remains unchanged.');
 button(textures,'Prepare Ultra textures','textures.prepare',null,off);
 button(textures,'AI textures (balanced)','ai.textures',{mode:'balanced',preserveMicrodetail:true,preserveStars:true},off);
 button(textures,'AI meshes (balanced)','ai.meshes',{mode:'balanced'},off);
 button(textures,'Delete Ultra cache…','textures.clear',null,off);
 const settings=section('Preparation settings','These switches do not enable or disable Enhanced Graphics. Metal sunlight uses the native renderer service supplied by the compatible launcher.');
 for(const spec of s.view.mod.settings){const label=el('label',spec.name+' ');let input;
   if(spec.type==='choice'){input=el('select');for(const choice of spec.choices||[]){const o=el('option',choice.name);o.value=String(choice.value);input.append(o);}input.value=String(spec.value);}
   else{input=el('input');input.type=spec.type==='bool'?'checkbox':spec.type==='int'||spec.type==='float'?'number':'text';if(input.type==='checkbox')input.checked=spec.value;else input.value=spec.value;if(spec.min!==undefined)input.min=spec.min;if(spec.max!==undefined)input.max=spec.max;if(spec.step!==undefined)input.step=spec.step;}
   input.disabled=off;input.onchange=()=>perform(()=>mod.action('setting',{key:spec.key,value:input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value}));label.append(input);if(spec.description)label.append(el('small',spec.description));settings.append(label);
 }
}
async function refresh(force=false){try{const s=await mod.status();if(force||!current||s.log!==current.log||s.job!==current.job||JSON.stringify(s.view.bake)!==JSON.stringify(current.view.bake))render(s);}catch(e){message.textContent=e.message;}}
enabled.onchange=()=>perform(()=>mod.enable(enabled.checked));
try{const info=await request('info');if(!info.services?.includes('graphics-preparation'))throw new Error('This launcher does not provide the graphics preparation service. Install fork launcher 1.0.5 or newer.');document.querySelector('#subtitle').textContent=`${info.game} / ${info.version} · Mod 0.1.0 · Independent from Enhanced Graphics`;await refresh(true);setInterval(()=>{if(!running)void refresh();},4000);}catch(e){message.textContent=e.message;}
