// SPDX-License-Identifier: GPL-3.0-or-later

export class PauseGate {
  #requested=false;
  #waiters=[];

  get requested(){return this.#requested}

  request(){
    this.#requested=true;
    return true;
  }

  resume(){
    if(!this.#requested)return false;
    this.#requested=false;
    const waiters=this.#waiters.splice(0);
    for(const resolve of waiters)resolve();
    return true;
  }

  async checkpoint(){
    if(!this.#requested)return false;
    await new Promise((resolve)=>this.#waiters.push(resolve));
    return true;
  }

  reset(){
    this.#requested=false;
    const waiters=this.#waiters.splice(0);
    for(const resolve of waiters)resolve();
  }
}
