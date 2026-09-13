import { afterEach, describe, expect, it, vi } from "vitest";
import { createPoseDemoController } from "./use-pose-demo";
import type { PoseDemoData } from "./pose-demo";

function fixture(reduced = false) {
  let visible: (entries: {isIntersecting: boolean}[]) => void = () => {};
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const context = new Proxy({ measureText: () => ({width: 30}) }, {get: (obj,key)=>key in obj ? obj[key as keyof typeof obj] : () => {}});
  const node = () => ({textContent:"",dataset:{},style:{setProperty:vi.fn()},setAttribute:vi.fn()});
  const canvas = {...node(),width:0,height:0,getContext:()=>context,getBoundingClientRect:()=>({width:640,height:360}),animate:vi.fn()};
  const playIcon = {...node(),textContent:"SVG icons"};
  const playButton = node();
  const scrubber = {...node(),value:"0",max:"1"};
  vi.stubGlobal("window",{matchMedia:()=>({matches:reduced,addEventListener:vi.fn(),removeEventListener:vi.fn()}),devicePixelRatio:1});
  vi.stubGlobal("document",{hidden:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});
  vi.stubGlobal("requestAnimationFrame",(callback:FrameRequestCallback)=>{callbacks.set(++nextId,callback);return nextId;});
  vi.stubGlobal("cancelAnimationFrame",(id:number)=>callbacks.delete(id));
  vi.stubGlobal("IntersectionObserver",class {constructor(callback:typeof visible){visible=callback;} observe(){} disconnect(){}});
  vi.stubGlobal("ResizeObserver",class {observe(){} disconnect(){}});
  const data: PoseDemoData = {version:3,layout:"mediapipe33",fps:10,sourceAspectRatio:16/9,autoAdvance:true,sequences:["sprint","shooting"].map(key=>({key,title:key,label:key,frames:[[],[]],markers:{},metrics:[]}))};
  const changed = vi.fn();
  const controller = createPoseDemoController(data,{canvas,playIcon,playButton,scrubber,timer:node(),phaseChip:node(),telemetryPhase:null} as unknown as Parameters<typeof createPoseDemoController>[1],changed)!;
  visible([{isIntersecting:true}]);
  let time = 1;
  const advance = (ms:number) => { for(let elapsed=0;elapsed<ms;elapsed+=50){time+=50;const pending=[...callbacks.values()];callbacks.clear();pending.forEach(callback=>callback(time));} };
  return {controller,advance,changed,playIcon,playButton};
}

afterEach(()=>vi.unstubAllGlobals());
describe("pose recording carousel",()=>{
  it("automatically advances and wraps after the final recording",()=>{
    const f=fixture();f.advance(900);expect(f.changed.mock.lastCall).toEqual([1]);f.advance(900);expect(f.changed.mock.lastCall).toEqual([0]);f.controller.destroy();
  });
  it("keeps the selected recording paused while navigating, then resumes",()=>{
    const f=fixture();f.controller.togglePlay();f.controller.stepSequence(-1);expect(f.changed.mock.lastCall).toEqual([1]);f.advance(2000);expect(f.changed.mock.lastCall).toEqual([1]);
    expect(f.playIcon.dataset).toEqual({playing:"false"});expect(f.playIcon.textContent).toBe("SVG icons");
    f.controller.togglePlay();expect(f.playIcon.dataset).toEqual({playing:"true"});f.advance(900);expect(f.changed.mock.lastCall).toEqual([0]);f.controller.destroy();
  });
  it("waits for explicit play when reduced motion is enabled",()=>{
    const f=fixture(true);f.advance(2000);expect(f.changed).toHaveBeenCalledTimes(1);f.controller.togglePlay();f.advance(900);expect(f.changed.mock.lastCall).toEqual([1]);f.controller.destroy();
  });
});
