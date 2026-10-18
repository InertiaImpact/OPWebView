import test from "node:test";
import assert from "node:assert/strict";
import { matmul3x3, matvec3, rotFromEuler, pathLengthIndex, RADAR_TO_CAMERA, leadBoxVertices, calculateFrameTransform, projectPoint } from "../public/src/render/projection.js";
import { createInitialState } from "../public/src/core/state.js";
import { OverlayRenderer } from "../public/src/render/overlay-renderer.js";

test("lead box anchors its rear at the camera-corrected track and extends forward, never toward ego", () => {
  for (const distance of [2,5,10,40,100]) {
    const box=leadBoxVertices(distance,.6,1.22);
    assert.ok(box.rear.every(([x])=>x===distance+RADAR_TO_CAMERA));
    assert.ok(box.front.every(([x])=>x===distance+RADAR_TO_CAMERA+4.5));
    assert.equal(box.rear[0][1],-1.5);
    assert.ok(Math.abs(box.rear[1][1]-.3)<1e-9);
    assert.equal(box.rear[2][2],1.22);
    assert.ok(Math.abs(box.rear[0][2]+.28)<1e-9);
  }
  for (const distance of [0,-1,NaN,Infinity]) assert.equal(leadBoxVertices(distance,0,1.22),null);
  assert.equal(leadBoxVertices(5,Infinity,1.22),null);
});

test("close lead boxes retain correct depth and finite projections in both camera modes", () => {
  for (const streamType of ["road","wideRoad"]) for (const distance of [2,5,10,40]) {
    const state={...createInitialState(),streamType,hudLayout:"detailed",rpyCalib:[0,.02,0],calStatus:"calibrated"};
    const matrix=calculateFrameTransform(state,1199,498).matrix;
    const box=leadBoxVertices(distance,0,1.22);
    const rear=box.rear.map(p=>projectPoint(matrix,p)),front=box.front.map(p=>projectPoint(matrix,p));
    assert.ok([...rear,...front].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    assert.ok(Math.abs(front[1].x-front[0].x)<Math.abs(rear[1].x-rear[0].x),"the farther front face must appear smaller");
  }
});

test("renderer projects corrected rear/front faces but keeps the raw lead distance tag", () => {
  const paths=[],texts=[];
  const context={beginPath(){paths.push([]);},moveTo(x,y){paths.at(-1).push({x,y});},lineTo(x,y){paths.at(-1).push({x,y});},
    closePath(){},stroke(){},measureText:()=>({width:20}),roundRect(){},fill(){},fillText(text){texts.push(text);}};
  const renderer={context,width:1199,height:498};
  const state={...createInitialState(),hudLayout:"detailed",pathX:[0,6,7,10],pathZ:[0,.25,.75,1]};
  const matrix=calculateFrameTransform(state,1199,498).matrix;
  const lead={dRel:5,yRel:.2,vRel:0};
  const box=leadBoxVertices(5,.2,1.22+.25);
  OverlayRenderer.prototype.drawReticle.call(renderer,lead,matrix,null,1.22,state,true);
  assert.deepEqual(paths[0],box.front.map(p=>projectPoint(matrix,p)));
  assert.deepEqual(paths[1],[projectPoint(matrix,box.rear[0]),projectPoint(matrix,box.front[0])]);
  assert.deepEqual(texts,["5 m"]);
  assert.equal(lead.dRel,5,"drawing must not mutate telemetry or following distance");
});

test("identity Euler rotation leaves a vector unchanged", () => {
  const rotation = rotFromEuler([0, 0, 0]);
  assert.deepEqual(matvec3(rotation, [3, 2, 1]), [3, 2, 1]);
});

test("3x3 multiplication composes transforms", () => {
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const matrix = [[2, 1, 0], [0, 3, 1], [1, 0, 4]];
  assert.deepEqual(matmul3x3(identity, matrix), matrix);
});

test("pathLengthIndex returns the last point not beyond the distance", () => {
  assert.equal(pathLengthIndex([0, 5, 10, 15], 11), 2);
});
