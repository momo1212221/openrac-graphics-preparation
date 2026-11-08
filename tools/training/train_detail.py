#!/usr/bin/env python3
"""Train a small material-detail residual CNN and export an ONNX refinement model."""
from __future__ import annotations
import argparse, json
from pathlib import Path
import torch
from torch import nn
from torch.utils.data import Dataset,DataLoader
from PIL import Image
import numpy as np

class Pairs(Dataset):
    def __init__(self,root:Path,material:str,split="train"):
        self.root=root
        self.rows=[json.loads(x) for x in (root/"manifest.jsonl").read_text().splitlines() if x.strip()]
        self.rows=[r for r in self.rows if r["split"]==split and (material=="all" or r["material"]==material)]
    def __len__(self): return len(self.rows)
    def __getitem__(self,i):
        r=self.rows[i]
        def load(name):
            a=np.asarray(Image.open(self.root/r[name]).convert("RGB"),dtype=np.float32)/255.
            return torch.from_numpy(a).permute(2,0,1)
        return load("input"),load("target")

class Block(nn.Module):
    def __init__(self,c=48):
        super().__init__();self.net=nn.Sequential(nn.Conv2d(c,c,3,1,1),nn.SiLU(),nn.Conv2d(c,c,3,1,1))
    def forward(self,x): return x+self.net(x)*.2

class DetailCNN(nn.Module):
    def __init__(self,c=48,blocks=8):
        super().__init__()
        self.head=nn.Conv2d(3,c,3,1,1)
        self.body=nn.Sequential(*[Block(c) for _ in range(blocks)])
        self.tail=nn.Conv2d(c,3,3,1,1)
    def forward(self,x): return torch.clamp(x+self.tail(self.body(self.head(x)))*.25,0,1)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("dataset",type=Path);ap.add_argument("output",type=Path)
    ap.add_argument("--material",default="all")
    ap.add_argument("--epochs",type=int,default=20);ap.add_argument("--batch",type=int,default=16)
    ap.add_argument("--lr",type=float,default=2e-4);ap.add_argument("--device",default="auto")
    args=ap.parse_args()
    device=("cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")) if args.device=="auto" else args.device
    ds=Pairs(args.dataset,args.material); loader=DataLoader(ds,batch_size=args.batch,shuffle=True,num_workers=2)
    if not len(ds): raise SystemExit("no matching training pairs")
    model=DetailCNN().to(device);opt=torch.optim.AdamW(model.parameters(),lr=args.lr)
    l1=nn.L1Loss()
    for epoch in range(args.epochs):
        model.train();total=0.
        for inp,target in loader:
            inp,target=inp.to(device),target.to(device)
            out=model(inp)
            # Fidelity-biased: colour L1 plus gradient consistency; no adversarial hallucination loss.
            gx=lambda z:z[:,:,:,1:]-z[:,:,:,:-1]
            gy=lambda z:z[:,:,1:,:]-z[:,:,:-1,:]
            loss=l1(out,target)+.18*l1(gx(out),gx(target))+.18*l1(gy(out),gy(target))
            opt.zero_grad(set_to_none=True);loss.backward();nn.utils.clip_grad_norm_(model.parameters(),1.0);opt.step()
            total+=float(loss.detach())*inp.shape[0]
        print(json.dumps({"epoch":epoch+1,"loss":total/len(ds),"device":device}))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    model=model.cpu().eval()
    dummy=torch.zeros(1,3,128,128)
    torch.onnx.export(model,dummy,args.output,input_names=["input"],output_names=["output"],
                      dynamic_axes={"input":{2:"height",3:"width"},"output":{2:"height",3:"width"}},
                      opset_version=18,dynamo=False)
    print(f"wrote {args.output}")

if __name__=="__main__": main()
