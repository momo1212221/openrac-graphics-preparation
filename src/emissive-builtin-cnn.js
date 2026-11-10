// SPDX-License-Identifier: GPL-3.0-or-later
// Tiny reproducible 3-layer convolutional emission classifier, inference only.
// Trained on PROCEDURAL/SYNTHETIC lamp/leaf/paint swatches, not real game art.
// Experimental: it is not a high-quality verified semantic segmenter.
// Runs offline (during material-pack export), not once per rendered frame.
export const BUILTIN_EMISSIVE_MODEL = 'synthetic-cnn-20261110-v1';
const PARAMS = 'tLARsYewuCXhqOKyi69qL9KnJa5Vq30peiCfquSyLq8cs3uYrK4tszAoXLF7sg8r1S6Rs3gr0akTvOmh7qtBvYS1GjRiJG01gixJMVU02q0vMSSuE7WfLMctgy22Nto3Pi8WOMgwF6mUiKsyt6YMLfksral0rvazvS1KrgMrT7ORI2CwV7CAoAGzhrBHs4CvjbOSkmWr5i17LJ2xBSxQsd6xaq1iMgmdKjh8PO41EDRpN5Uw4LCBtkExO7LitWysxLBmtZCuO7TUq9CsIy4DOVA1EagsNCemm66jIX8mjbdfMqoqfrZAMIOoqrXVJAogAbjfrxqnt7j1LCWpvCr/MBgw57EvM4wwHq/1NFaiwyl7srUsBrKRsDUiY6jaspSt2qZEtWi0nbTktJuy6rHssHWyMrQSrWS0mq4+s0e0UbN2tZCrxLGzrvyzari8PEcrGyhBsdmv2ysOJPEq/CX1qhCyaK23IHWpcZwQsMqioq4VryGqP69csLgjZyjTKbcgj7CRrX2ogLDXoVqy0qQsssYmprAXscSkqyEtsFivorF4pyOuX7HqsbGooaQMMVeonzBwI7cooKpzHoQsLyetJgMwnDF8MtwyoynJLgIreio+Nkwt8zjQOw45cjmXO444LS9/LA4j1DCdJrUonKlIKhky7zXgN6cwhji5OFk2Zy72M5MtaaxTNzY6Gy3INJc6AqoTKbM8Sa0WIjcwfijrKu+sJqvNLKSspbKSK4GscqNhMDOwn7B5MqEpcLDmKZAn9a3VqHawzhwgGuuw5bGWrLOsn6XIsAYsBqytJ6ura60Vr9Owl65ascits60wqH+wtK21KyGvEp71rb0seLFkr4Gy3Sz2MCAxYa/8q0SnDZ+LIRWiQpxVJJQscikyMD2vSrCtriamEbYmuCGlVaokubW3ZLjrudWzHyWaqycwtCIkrzsrKpm1oVCvri39tCG3cLEIvJC4XTeFrHM0tzKiLpA7kS2yMvQ85y8vMOc4/ywspX2XGS4LLDOw9KXGrVkiOaldsponfJkhrAastaxlLOuujLC0tw6197SMuqW2obWduT63bJV6sjexOCsIqp2vyqziqIOuDjDutd22QK0euM+2njAyLxCmlaioqUk85TLBNH48Ca21M+s2fzDNKJcuuy/wqjGd2KzAMV6mN6zfLq0sR678KRGVJrBxKZQZkbJFr9wkDrBOrgSwlagtswOxoq9KsC4ifq4PLGqXe68dL0QtsZwSsVWq86QitGOoMKipsL6xISjnm0ww4bLpLBawKKo3IrCyma/iqlgmVCWSryavyS7MrYgturBwtAGxUDpeN4C0La13N1e1mr8ZvckiIbg=';
function half(v) {
  const s = (v & 0x8000) ? -1 : 1;
  const e = (v >>> 10) & 31;
  const m = v & 1023;
  if(e === 0) return s * Math.pow(2,-14) * m/1024;
  if(e === 31) return m ? NaN : s*Infinity;
  return s * Math.pow(2,e-15) * (1+m/1024);
}
function decode() {
  const raw = atob(PARAMS), n=raw.length/2;
  const values = new Float32Array(n);
  for(let i=0;i<n;i++)values[i]=half(raw.charCodeAt(i*2)|(raw.charCodeAt(i*2+1)<<8));
  if(n!==505||values.some(v=>!Number.isFinite(v)))throw new Error('invalid built-in emissive CNN weights');
  return values;
}
let parameters;
function conv(input,w,h,inChannels,outChannels,kernel,weights,bias,relu) {
  const out=new Float32Array(w*h*outChannels);
  const pad=kernel>>1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const pix=y*w+x;
    for(let oc=0;oc<outChannels;oc++){
      let s=bias[oc];
      for(let ic=0;ic<inChannels;ic++){
        const wBase=((oc*inChannels+ic)*kernel)*kernel;
        const inBase=ic*w*h;
        for(let ky=0;ky<kernel;ky++){
          const sy=y+ky-pad;
          if(sy<0||sy>=h)continue;
          for(let kx=0;kx<kernel;kx++){
            const sx=x+kx-pad;
            if(sx<0||sx>=w)continue;
            s+=input[inBase+sy*w+sx]*weights[wBase+ky*kernel+kx];
          }
        }
      }
      out[oc*w*h+pix]=relu?Math.max(0,s):s;
    }
  }
  return out;
}
function imageValid(im){
  return Number.isInteger(im?.width)&&Number.isInteger(im?.height)
    &&im.width>0&&im.height>0&&im.width<=16384&&im.height<=16384
    &&im.width*im.height<=64*1024*1024
    &&(im.data instanceof Uint8Array||im.data instanceof Uint8ClampedArray)
    &&im.data.length===im.width*im.height*4;
}
/**
 * Full-resolution probability mask with bounded, downsampled CNN inference.
 * No ONNX WebGPU dependency: runs in browser's CPU while exporting material PNGs.
 * The output is used ONLY by the opt-in offline material maps fusion, never real-time Bloom.
 */
export function predictBuiltinEmissive(image,{maxSide=128}={}){
  if(!imageValid(image))throw new TypeError('expected a valid RGBA8 image');
  if(!Number.isInteger(maxSide)||maxSide<32||maxSide>256)throw new RangeError('invalid maxSide');
  const {width,height,data}=image;
  const ratio=Math.min(1,maxSide/Math.max(width,height));
  const w=Math.max(1,Math.ceil(width*ratio)),h=Math.max(1,Math.ceil(height*ratio));
  const input=new Float32Array(3*w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const sx=Math.min(width-1,Math.floor((x+.5)*width/w));
    const sy=Math.min(height-1,Math.floor((y+.5)*height/h));
    const j=(sy*width+sx)*4;
    if(data[j+3]<16)continue;
    const p=y*w+x;
    for(let c=0;c<3;c++)input[c*w*h+p]=data[j+c]/255;
  }
  const a=parameters??(parameters=decode());
  let off=0;
  const take=n=>{const v=a.subarray(off,off+n);off+=n;return v;};
  const aW=take(6*3*3*3),aB=take(6),bW=take(6*6*3*3),bB=take(6),cW=take(6),cB=take(1);
  const l1=conv(input,w,h,3,6,3,aW,aB,true);
  const l2=conv(l1,w,h,6,6,3,bW,bB,true);
  const output=conv(l2,w,h,6,1,1,cW,cB,false);
  const probabilities=new Float32Array(width*height);
  // Smooth interpolation to source resolution. The material fusion preserves alpha and
  // requires high confidence; it rejects green foliage by default.
  for(let y=0;y<height;y++){
    const fy=(y+.5)*h/height-.5, y0=Math.max(0,Math.min(h-1,Math.floor(fy)));
    const y1=Math.min(h-1,y0+1), ty=Math.max(0,Math.min(1,fy-y0));
    for(let x=0;x<width;x++){
      const p=y*width+x,j=p*4;
      if(data[j+3]<16)continue;
      const fx=(x+.5)*w/width-.5,x0=Math.max(0,Math.min(w-1,Math.floor(fx)));
      const x1=Math.min(w-1,x0+1),tx=Math.max(0,Math.min(1,fx-x0));
      const value=(output[y0*w+x0]*(1-tx)+output[y0*w+x1]*tx)*(1-ty)
       +(output[y1*w+x0]*(1-tx)+output[y1*w+x1]*tx)*ty;
      probabilities[p]=1/(1+Math.exp(-Math.max(-30,Math.min(30,value))));
    }
  }
  return {width,height,probabilities};
}
