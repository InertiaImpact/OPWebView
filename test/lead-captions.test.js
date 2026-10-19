import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, leadMotion } from "../public/src/core/state.js";
import { OverlayRenderer } from "../public/src/render/overlay-renderer.js";
import { calculateFrameTransform } from "../public/src/render/projection.js";
import { WIDGETS } from "../public/src/widgets/widget-catalog.js";

function fixture() {
  const labels=[],backgrounds=[];
  const context={globalAlpha:1,beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},
    measureText:t=>({width:t.length*9}),roundRect(x,y,w,h){backgrounds.push({x,y,w,h});},fill(){},
    fillText(text,x,y){labels.push({text,x,y,alpha:this.globalAlpha});}};
  const renderer=Object.assign(Object.create(OverlayRenderer.prototype),{context,width:1199,height:498});
  const state={...createInitialState(),hudLayout:"detailed",vEgo:20,pathX:[0,20,40],pathZ:[0,0,0]};
  const lead={present:true,dRel:20,yRel:0,vRel:-2}; state.leadOne=lead;
  const matrix=calculateFrameTransform(state,1199,498).matrix;
  return {labels,backgrounds,renderer,state,lead,draw:(tag=true)=>renderer.drawReticle(lead,matrix,null,1.22,state,tag)};
}

test("lead motion uses the same units and impact calculation for widgets and marker captions",()=>{
  for (const isMetric of [true,false]) {
    const f=fixture(); f.state.isMetric=isMetric;
    const motion=leadMotion(f.lead,f.state);
    assert.equal(motion.impact,10); assert.equal(motion.speed,isMetric?65:40);
    const html=WIDGETS.find(w=>w.id==="detailedLead").render(f.state);
    assert.ok(html.includes(`${motion.speed} ${isMetric?'km/h':'mph'}`)); assert.ok(html.includes("10.0 s"));
    f.draw(); assert.deepEqual(f.labels.map(x=>x.text),[isMetric?"20 m":"66 ft",isMetric?"65 km/h":"40 mph","TTI 10.0 s"]);
    assert.ok(f.labels[2].y>f.labels[1].y,"TTI sits below lead speed");
  }
});

test("invalid, zero-distance, non-closing and very distant impact estimates remain hidden",()=>{
  for(const [dRel,vRel] of [[20,0],[20,2],[20,-.1],[0,-2],[-2,-2],[NaN,-2],[Infinity,-2],[20,Infinity],[20,-Infinity],[20,NaN],[20,null],[198,-2]]) {
    assert.equal(leadMotion({dRel,vRel},{...createInitialState(),vEgo:20}).impact,null);
  }
  assert.equal(leadMotion({dRel:20,vRel:NaN},{vEgo:20}).speed,null);
  assert.equal(leadMotion({dRel:20,vRel:-2},{...createInitialState(),vEgo:1}).speed,0);
});

test("impact fades in once over 250 ms, resets when unavailable, and restores canvas opacity",t=>{
  let now=0; t.mock.method(performance,"now",()=>now);
  const f=fixture();
  for(const [time,alpha] of [[0,0],[125,.5],[250,1],[1000,1]]) {
    now=time; f.draw(); assert.equal(f.labels.at(-1).alpha,alpha); assert.equal(f.renderer.context.globalAlpha,1);
  }
  f.lead.vRel=1; f.labels.length=0; f.draw();
  assert.deepEqual(f.labels.map(x=>x.text),["20 m","76 km/h"]); assert.equal(f.renderer.impactLabel,null);
  now=2000; f.lead.vRel=-2; f.draw(); assert.equal(f.labels.at(-1).alpha,0);
  f.lead.present=false; f.renderer.drawLeads(null,null,null,1.22,f.state); assert.equal(f.renderer.impactLabel,null);
});

test("caption backgrounds stay on screen and secondary untagged boxes do not gain captions",()=>{
  const f=fixture(); f.lead.dRel=3; f.lead.yRel=1; f.draw();
  // The top distance label retains its existing HUD position; new bottom rows fit.
  for(const rect of f.backgrounds.slice(1)) {
    assert.ok(rect.x>=0 && rect.x+rect.w<=f.renderer.width);
    assert.ok(rect.y>=0 && rect.y+rect.h<=f.renderer.height);
  }
  f.labels.length=0; f.draw(false); assert.equal(f.labels.length,0);
});
