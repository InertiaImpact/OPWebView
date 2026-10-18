import test from "node:test";
import assert from "node:assert/strict";
import { TelemetryStore } from "../public/src/core/state.js";
import { CerealAdapter } from "../public/src/core/telemetry-adapter.js";
import { WIDGETS } from "../public/src/widgets/widget-catalog.js";
import { OverlayRenderer } from "../public/src/render/overlay-renderer.js";

function fixture(enabled,flag="present") {
  const store=new TelemetryStore(),adapter=new CerealAdapter(store);
  for(const [type,data] of [["deviceState",{started:true}],["selfdriveState",{enabled,state:enabled?"enabled":"disabled"}],
    ["carState",{vEgo:20}],["radarState",{leadOne:{[flag]:true,dRel:8,yRel:0,vRel:-1},leadTwo:{[flag]:false}}]]) {
    adapter.apply(JSON.stringify({type,data}));
  }
  return {store,adapter};
}

test("valid lead readouts remain identical engaged and disengaged for current/legacy presence flags",()=>{
  for(const flag of ["present","status"]) {
    const engaged=fixture(true,flag).store.state,disengaged=fixture(false,flag).store.state;
    assert.equal(disengaged.status,"disengaged");
    for(const id of ["lead","detailedLead"]) {
      const widget=WIDGETS.find(w=>w.id===id);
      assert.equal(widget.render(disengaged),widget.render(engaged));
      assert.match(widget.render(disengaged),/0\.4 s/);
    }
  }
});

test("both reticles stay visible in Enhanced/Detailed without engagement and preserve duplicate suppression",()=>{
  for(const hudLayout of ["enhanced","detailed"]) {
    const state=fixture(false).store.state;state.hudLayout=hudLayout;
    const drawn=[],renderer={drawReticle:(lead,...args)=>drawn.push({lead,tag:args.at(-1)})};
    const draw=()=>OverlayRenderer.prototype.drawLeads.call(renderer,null,null,null,1.22,state);
    draw();assert.equal(drawn.length,1);assert.equal(drawn[0].tag,true);
    state.leadTwo={present:true,dRel:20,yRel:1,vRel:0};drawn.length=0;draw();assert.equal(drawn.length,2);
    state.leadTwo.dRel=9;drawn.length=0;draw();assert.equal(drawn.length,1);
  }
});

test("lost/absent tracks clear lead readouts and boxes rather than inventing a lead while disengaged",()=>{
  const {store,adapter}=fixture(false);
  adapter.apply(JSON.stringify({type:"radarState",data:{leadOne:{present:false,dRel:8},leadTwo:{present:false}}}));
  for(const id of ["lead","detailedLead"]) {
    const html=WIDGETS.find(w=>w.id===id).render(store.state);
    assert.match(html,/– –/);assert.doesNotMatch(html,/0\.4 s|8 m/);
  }
  store.state.hudLayout="detailed";
  OverlayRenderer.prototype.drawLeads.call({drawReticle:()=>assert.fail("absent tracks must not render")},null,null,null,1.22,store.state);
});
