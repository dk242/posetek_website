import { describe, expect, it } from 'vitest';
import { alignReference, techniqueData } from './technique-model';

describe('professional ghost alignment', () => {
  const contact = techniqueData.phases.find(p=>p.key==='contact')!;
  const player = techniqueData.frames[contact.index], reference = contact.referencePose!;
  it('anchors the planted foot and preserves relative limb proportions', () => {
    const original = JSON.stringify(reference);
    const aligned = alignReference(reference,player,reference);
    const plant=(p:number[][])=>p[27][1]>p[28][1]?27:28;
    expect(aligned[plant(reference)]).toEqual(player[plant(player)].slice(0,2));
    const length=(p:number[][],a:number,b:number)=>Math.hypot((p[a][0]-p[b][0])*16/9,p[a][1]-p[b][1]);
    const scales=[[11,13],[13,15],[23,25],[25,27]].map(([a,b])=>length(aligned,a,b)/length(reference,a,b));
    scales.forEach(scale=>expect(scale).toBeCloseTo(scales[0],8));
    expect(JSON.stringify(reference)).toBe(original);
  });
  it('uses only available saved phases', () => {
    expect(techniqueData.phases.filter(p=>p.referencePose).map(p=>p.key)).toEqual(['backswing','contact']);
    for (const phase of techniqueData.phases.filter(p=>p.referencePose)) expect(alignReference(phase.referencePose!,player,reference).flat().every(Number.isFinite)).toBe(true);
  });
});
