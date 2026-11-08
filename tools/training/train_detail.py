#!/usr/bin/env python3
"""Train a material-detail residual CNN with resumable checkpoints and validation."""
from __future__ import annotations

import argparse
import json
import math
import random
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler

class Pairs(Dataset):
    def __init__(self,root:Path,material:str,split="train",augment=False):
        self.root=root
        self.augment=augment
        self.rows=[
            json.loads(x)
            for x in (root/"manifest.jsonl").read_text(encoding="utf-8").splitlines()
            if x.strip()
        ]
        self.rows=[
            r for r in self.rows
            if r["split"]==split and (material=="all" or r["material"]==material)
        ]

    def __len__(self):
        return len(self.rows)

    def __getitem__(self,i):
        r=self.rows[i]
        def load(name):
            a=np.asarray(Image.open(self.root/r[name]).convert("RGB"),dtype=np.float32)/255.
            return torch.from_numpy(a).permute(2,0,1)
        inp,target=load("input"),load("target")
        if self.augment:
            # Same geometric transform for input and target; never alter colour independently.
            if torch.rand(())<.5:
                inp=torch.flip(inp,(-1,));target=torch.flip(target,(-1,))
            if torch.rand(())<.5:
                inp=torch.flip(inp,(-2,));target=torch.flip(target,(-2,))
            k=int(torch.randint(0,4,()).item())
            if k:
                inp=torch.rot90(inp,k,(-2,-1));target=torch.rot90(target,k,(-2,-1))
        return inp,target

class Block(nn.Module):
    def __init__(self,c=48):
        super().__init__()
        self.net=nn.Sequential(
            nn.Conv2d(c,c,3,1,1),
            nn.SiLU(),
            nn.Conv2d(c,c,3,1,1),
        )
    def forward(self,x):
        return x+self.net(x)*.2

class DetailCNN(nn.Module):
    def __init__(self,c=48,blocks=8):
        super().__init__()
        self.head=nn.Conv2d(3,c,3,1,1)
        self.body=nn.Sequential(*[Block(c) for _ in range(blocks)])
        self.tail=nn.Conv2d(c,3,3,1,1)

    def forward(self,x):
        return torch.clamp(x+self.tail(self.body(self.head(x)))*.25,0,1)

def seed_everything(seed:int):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)

def fidelity_loss(out,target,l1):
    gx=lambda z:z[:,:,:,1:]-z[:,:,:,:-1]
    gy=lambda z:z[:,:,1:,:]-z[:,:,:-1,:]
    colour=l1(out,target)
    grad_x=l1(gx(out),gx(target))
    grad_y=l1(gy(out),gy(target))
    return colour+.18*grad_x+.18*grad_y,colour,grad_x,grad_y

def source_balanced_sampler(ds:Pairs,seed:int):
    counts=Counter(str(r.get("source_sha256") or r.get("source") or r.get("id")) for r in ds.rows)
    weights=[
        1.0/max(1,counts[str(r.get("source_sha256") or r.get("source") or r.get("id"))])
        for r in ds.rows
    ]
    generator=torch.Generator()
    generator.manual_seed(seed)
    return WeightedRandomSampler(weights,num_samples=len(weights),replacement=True,generator=generator)

def make_loader(ds,batch,workers,shuffle,seed,balance=False):
    generator=torch.Generator()
    generator.manual_seed(seed)
    sampler=source_balanced_sampler(ds,seed) if balance else None
    return DataLoader(
        ds,
        batch_size=batch,
        shuffle=shuffle and sampler is None,
        sampler=sampler,
        num_workers=workers,
        pin_memory=torch.cuda.is_available(),
        persistent_workers=workers>0,
        generator=generator,
    )

def evaluate(model,loader,device,l1):
    if not len(loader.dataset):
        return None
    model.eval()
    total=colour=grad_x=grad_y=0.0
    seen=0
    with torch.no_grad():
        for inp,target in loader:
            inp,target=inp.to(device),target.to(device)
            out=model(inp)
            loss,c,gx,gy=fidelity_loss(out,target,l1)
            n=inp.shape[0]
            total+=float(loss)*n
            colour+=float(c)*n
            grad_x+=float(gx)*n
            grad_y+=float(gy)*n
            seen+=n
    return {
        "loss":total/max(1,seen),
        "colour_l1":colour/max(1,seen),
        "gradient_x_l1":grad_x/max(1,seen),
        "gradient_y_l1":grad_y/max(1,seen),
        "pairs":seen,
    }

def load_checkpoint(path:Path,model,opt,expected_material):
    try:
        checkpoint=torch.load(path,map_location="cpu",weights_only=False)
    except TypeError:
        checkpoint=torch.load(path,map_location="cpu")
    if checkpoint.get("material")!=expected_material:
        raise SystemExit(
            f"checkpoint material {checkpoint.get('material')!r} does not match --material {expected_material!r}"
        )
    model.load_state_dict(checkpoint["model"])
    opt.load_state_dict(checkpoint["optimizer"])
    return checkpoint

def save_checkpoint(path:Path,model,opt,epoch,best_val,bad_epochs,args):
    path.parent.mkdir(parents=True,exist_ok=True)
    torch.save({
        "version":1,
        "epoch":epoch,
        "model":model.state_dict(),
        "optimizer":opt.state_dict(),
        "best_validation_loss":best_val,
        "bad_epochs":bad_epochs,
        "material":args.material,
        "seed":args.seed,
        "channels":args.channels,
        "blocks":args.blocks,
    },path)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("dataset",type=Path)
    ap.add_argument("output",type=Path)
    ap.add_argument("--material",default="all")
    ap.add_argument("--epochs",type=int,default=20)
    ap.add_argument("--batch",type=int,default=16)
    ap.add_argument("--lr",type=float,default=2e-4)
    ap.add_argument("--device",default="auto")
    ap.add_argument("--workers",type=int,default=2)
    ap.add_argument("--seed",type=int,default=1337)
    ap.add_argument("--patience",type=int,default=6,help="Stop after this many validation epochs without improvement; 0 disables.")
    ap.add_argument("--channels",type=int,default=48)
    ap.add_argument("--blocks",type=int,default=8)
    ap.add_argument("--augment",action="store_true",help="Apply matched flips/90-degree rotations to input and target.")
    ap.add_argument("--no-source-balance",action="store_true",help="Disable source-balanced sampling.")
    ap.add_argument("--resume",action="store_true",help="Resume model/optimizer/epoch from the checkpoint path.")
    ap.add_argument("--checkpoint",type=Path,default=None)
    args=ap.parse_args()

    if args.epochs<=0 or args.batch<=0 or args.lr<=0:
        raise SystemExit("--epochs, --batch and --lr must be positive")
    seed_everything(args.seed)

    device=(
        "cuda" if torch.cuda.is_available()
        else ("mps" if torch.backends.mps.is_available() else "cpu")
    ) if args.device=="auto" else args.device

    train_ds=Pairs(args.dataset,args.material,"train",augment=args.augment)
    validation_ds=Pairs(args.dataset,args.material,"validation",augment=False)
    if not len(train_ds):
        raise SystemExit("no matching training pairs")

    train_loader=make_loader(
        train_ds,args.batch,args.workers,True,args.seed,
        balance=not args.no_source_balance,
    )
    validation_loader=make_loader(
        validation_ds,args.batch,args.workers,False,args.seed+1,
        balance=False,
    ) if len(validation_ds) else None

    model=DetailCNN(c=args.channels,blocks=args.blocks).to(device)
    opt=torch.optim.AdamW(model.parameters(),lr=args.lr)
    scheduler=torch.optim.lr_scheduler.ReduceLROnPlateau(opt,mode="min",factor=.5,patience=2,min_lr=1e-6)
    l1=nn.L1Loss()

    checkpoint_path=args.checkpoint or args.output.with_suffix(".checkpoint.pt")
    best_path=args.output.with_suffix(".best.pt")
    start_epoch=0
    best_val=math.inf
    bad_epochs=0

    if args.resume:
        if not checkpoint_path.exists():
            raise SystemExit(f"checkpoint does not exist: {checkpoint_path}")
        checkpoint=load_checkpoint(checkpoint_path,model,opt,args.material)
        start_epoch=int(checkpoint.get("epoch",0))
        best_val=float(checkpoint.get("best_validation_loss",math.inf))
        bad_epochs=int(checkpoint.get("bad_epochs",0))
        print(json.dumps({
            "resume":True,
            "checkpoint":str(checkpoint_path),
            "next_epoch":start_epoch+1,
            "best_validation_loss":best_val,
        }))

    for epoch in range(start_epoch,args.epochs):
        model.train()
        total=colour=grad_x=grad_y=0.0
        seen=0
        for inp,target in train_loader:
            inp,target=inp.to(device),target.to(device)
            out=model(inp)
            loss,c,gx,gy=fidelity_loss(out,target,l1)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(),1.0)
            opt.step()
            n=inp.shape[0]
            total+=float(loss.detach())*n
            colour+=float(c.detach())*n
            grad_x+=float(gx.detach())*n
            grad_y+=float(gy.detach())*n
            seen+=n

        validation=evaluate(model,validation_loader,device,l1) if validation_loader else None
        monitor=validation["loss"] if validation else total/max(1,seen)
        scheduler.step(monitor)

        improved=monitor<best_val-1e-7
        if improved:
            best_val=monitor
            bad_epochs=0
            best_path.parent.mkdir(parents=True,exist_ok=True)
            torch.save(model.state_dict(),best_path)
        else:
            bad_epochs+=1

        save_checkpoint(
            checkpoint_path,model,opt,epoch+1,best_val,bad_epochs,args
        )

        row={
            "epoch":epoch+1,
            "train_loss":total/max(1,seen),
            "train_colour_l1":colour/max(1,seen),
            "train_gradient_x_l1":grad_x/max(1,seen),
            "train_gradient_y_l1":grad_y/max(1,seen),
            "validation":validation,
            "best_validation_loss":best_val,
            "bad_epochs":bad_epochs,
            "lr":opt.param_groups[0]["lr"],
            "device":device,
            "source_balanced":not args.no_source_balance,
            "augment":args.augment,
            "checkpoint":str(checkpoint_path),
        }
        print(json.dumps(row))

        if validation and args.patience>0 and bad_epochs>=args.patience:
            print(json.dumps({"early_stop":True,"epoch":epoch+1,"patience":args.patience}))
            break

    if best_path.exists():
        try:
            state=torch.load(best_path,map_location="cpu",weights_only=True)
        except TypeError:
            state=torch.load(best_path,map_location="cpu")
        model=model.cpu()
        model.load_state_dict(state)
    else:
        model=model.cpu()
    model.eval()

    args.output.parent.mkdir(parents=True,exist_ok=True)
    dummy=torch.zeros(1,3,128,128)
    torch.onnx.export(
        model,dummy,args.output,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input":{2:"height",3:"width"},"output":{2:"height",3:"width"}},
        opset_version=18,
        dynamo=False,
    )
    print(json.dumps({
        "output":str(args.output),
        "checkpoint":str(checkpoint_path),
        "best_weights":str(best_path) if best_path.exists() else None,
        "material":args.material,
        "train_pairs":len(train_ds),
        "validation_pairs":len(validation_ds),
        "seed":args.seed,
    },indent=2))

if __name__=="__main__":
    main()
