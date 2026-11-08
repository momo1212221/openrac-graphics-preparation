// SPDX-License-Identifier: GPL-3.0-or-later

const clamp01=(value)=>Math.max(0,Math.min(1,Number(value)||0));

export function formatDuration(ms,{compact=false}={}){
  if(!Number.isFinite(ms)||ms<0)return "—";
  const total=Math.max(0,Math.round(ms/1000));
  const s=total%60;
  const m=Math.floor(total/60)%60;
  const h=Math.floor(total/3600);
  if(h>0)return compact?`${h}h ${m}m`:`${h} h ${m} min`;
  if(m>0)return compact?`${m}m ${s}s`:`${m} min ${s} s`;
  return `${s} s`;
}

export class ProgressEstimator{
  constructor({now=()=>performance.now(),alpha=.22,minEtaMs=5000}={}){
    this.now=now;
    this.alpha=alpha;
    this.minEtaMs=minEtaMs;
    this.reset();
  }

  reset(totalUnits=1){
    const now=this.now();
    this.totalUnits=Math.max(1,Number(totalUnits)||1);
    this.startedAt=now;
    this.lastSampleAt=now;
    this.lastSampleFraction=0;
    this.fraction=0;
    this.emaRate=null;
    this.pausedAt=null;
    this.pausedMs=0;
    this.samples=0;
    return this.snapshot(now);
  }

  pause(){
    if(this.pausedAt===null)this.pausedAt=this.now();
  }

  resume(){
    if(this.pausedAt===null)return;
    const now=this.now();
    const paused=Math.max(0,now-this.pausedAt);
    this.pausedMs+=paused;
    this.lastSampleAt+=paused;
    this.pausedAt=null;
  }

  update(done,total=1,{sampleRate=true}={}){
    const now=this.now();
    const safeTotal=Math.max(1,Number(total)||1);
    const fraction=clamp01(Number(done)/safeTotal);

    if(sampleRate && this.pausedAt===null && fraction>this.lastSampleFraction){
      const dt=now-this.lastSampleAt;
      const df=fraction-this.lastSampleFraction;
      if(dt>=100 && df>0){
        const rate=df/dt;
        if(Number.isFinite(rate)&&rate>0){
          this.emaRate=this.emaRate===null?rate:this.emaRate*(1-this.alpha)+rate*this.alpha;
          this.samples++;
        }
        this.lastSampleAt=now;
        this.lastSampleFraction=fraction;
      }
    }else if(fraction<this.lastSampleFraction){
      // A new phase must call reset(). Ignore backwards progress instead of corrupting ETA.
      this.lastSampleAt=now;
    }

    this.fraction=fraction;
    return this.snapshot(now);
  }

  snapshot(now=this.now()){
    const pauseNow=this.pausedAt===null?0:Math.max(0,now-this.pausedAt);
    const elapsedMs=Math.max(0,now-this.startedAt-this.pausedMs-pauseNow);
    const overallRate=this.fraction>0&&elapsedMs>0?this.fraction/elapsedMs:null;
    let rate=null;
    if(overallRate&&this.emaRate)rate=overallRate*.72+this.emaRate*.28;
    else rate=overallRate||this.emaRate;

    const etaReady=this.samples>=2&&elapsedMs>=this.minEtaMs&&this.fraction>0&&this.fraction<1&&rate>0;
    const etaMs=etaReady?Math.min((1-this.fraction)/rate,7*24*60*60*1000):null;
    const unitsPerMinute=rate?rate*60000*this.totalUnits:null;
    return {
      fraction:this.fraction,
      percent:this.fraction*100,
      elapsedMs,
      etaMs,
      unitsPerMinute,
      samples:this.samples,
      paused:this.pausedAt!==null,
    };
  }
}
