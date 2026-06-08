#include "common.wgsl"

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> densities: array<f32>;
@group(0) @binding(4) var<storage, read> pressures: array<f32>;
@group(0) @binding(5) var<storage, read_write> positionsOut: array<vec2<f32>>;
@group(0) @binding(6) var<storage, read_write> velocitiesOut: array<vec2<f32>>;
@group(0) @binding(7) var<storage, read> cellStart: array<u32>;
@group(0) @binding(8) var<storage, read> cellEnd: array<u32>;
@group(0) @binding(9) var<storage, read> particleIndices: array<u32>;
@group(0) @binding(10) var<storage, read> obstacles: array<Obstacle>;
@group(0) @binding(11) var<uniform> obstacleCount: u32;

fn handleBoundaryCollisions(pos: vec2<f32>, params: Params) -> vec2<f32> {
  var result: vec2<f32> = pos;
  let margin: f32 = 5.0;
  let minX: f32 = params.boundaryMinX + margin;
  let maxX: f32 = params.boundaryMaxX - margin;
  let minY: f32 = params.boundaryMinY + margin;
  let maxY: f32 = params.boundaryMaxY - margin;
  result.x = clamp(result.x, minX, maxX);
  result.y = clamp(result.y, minY, maxY);
  return result;
}

fn handleObstacles(pos: vec2<f32>, obstacleCount: u32, obstacles: array<Obstacle>) -> vec2<f32> {
  var result: vec2<f32> = pos;
  
  for (var i: u32 = 0u; i < obstacleCount; i++) {
    let obs: Obstacle = obstacles[i];
    
    if (obs.type == 0u) {
      let diff: vec2<f32> = result - vec2<f32>(obs.x, obs.y);
      let dist: f32 = length(diff);
      let minDist: f32 = obs.radius + 8.0;
      
      if (dist < minDist) {
        var dir: vec2<f32> = diff + vec2<f32>(0.0001, 0.0001);
        dir = normalize(dir);
        result = vec2<f32>(obs.x, obs.y) + dir * minDist;
      }
    } else if (obs.type == 2u) {
      let halfW: f32 = obs.width * 0.5;
      let halfH: f32 = obs.height * 0.5;
      let cosR: f32 = cos(-obs.rotation);
      let sinR: f32 = sin(-obs.rotation);
      
      let tx: f32 = result.x - obs.x;
      let ty: f32 = result.y - obs.y;
      let localX: f32 = cosR * tx - sinR * ty;
      let localY: f32 = sinR * tx + cosR * ty;
      
      let clampedX: f32 = clamp(localX, -halfW, halfW);
      let clampedY: f32 = clamp(localY, -halfH, halfH);
      
      let dx: f32 = localX - clampedX;
      let dy: f32 = localY - clampedY;
      let distSq: f32 = dx * dx + dy * dy;
      
      if (distSq < 64.0) {
        var pushDirX: f32 = 0.0;
        var pushDirY: f32 = 0.0;
        var pushDist: f32 = 0.0;
        
        if (distSq < 0.0001) {
          let absX: f32 = abs(localX) / halfW;
          let absY: f32 = abs(localY) / halfH;
          if (absX > absY) {
            pushDirX = sign(localX);
            pushDirY = 0.0;
          } else {
            pushDirX = 0.0;
            pushDirY = sign(localY);
          }
          pushDist = 8.0;
        } else {
          let dist: f32 = sqrt(distSq);
          pushDirX = dx / dist;
          pushDirY = dy / dist;
          pushDist = 8.0 - dist;
        }
        
        let cosRot: f32 = cos(obs.rotation);
        let sinRot: f32 = sin(obs.rotation);
        let worldDirX: f32 = cosRot * pushDirX - sinRot * pushDirY;
        let worldDirY: f32 = sinRot * pushDirX + cosRot * pushDirY;
        
        result.x = result.x + worldDirX * pushDist;
        result.y = result.y + worldDirY * pushDist;
      }
    }
  }
  
  return result;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let i: u32 = globalId.x;
  if (i >= params.particleCount) { return; }

  let h: f32 = params.smoothingRadius;
  let h2: f32 = h * h;
  let posI: vec2<f32> = positions[i];
  let velI: vec2<f32> = velocities[i];
  let densI: f32 = max(densities[i], 1.0);
  let pressI: f32 = pressures[i];
  let cellI: vec2<i32> = getCellIndex(posI, params);
  
  var pressureForce: vec2<f32> = vec2<f32>(0.0, 0.0);
  var viscosityForce: vec2<f32> = vec2<f32>(0.0, 0.0);
  
  for (var dx: i32 = -1; dx <= 1; dx++) {
    for (var dy: i32 = -1; dy <= 1; dy++) {
      let neighborCell: vec2<i32> = cellI + vec2<i32>(dx, dy);
      let maxX: i32 = i32(params.gridResX);
      let maxY: i32 = i32(params.gridResY);
      
      if (neighborCell.x < 0 || neighborCell.x >= maxX ||
          neighborCell.y < 0 || neighborCell.y >= maxY) {
        continue;
      }
      
      let cellHash: u32 = getCellHash(neighborCell, params);
      let start: u32 = cellStart[cellHash];
      let end: u32 = cellEnd[cellHash];
      
      if (start == end) { continue; }
      
      for (var k: u32 = start; k < end; k++) {
        let j: u32 = particleIndices[k];
        if (i == j) { continue; }
        
        let posJ: vec2<f32> = positions[j];
        let velJ: vec2<f32> = velocities[j];
        let diff: vec2<f32> = posI - posJ;
        let r2: f32 = dot(diff, diff);
        
        if (r2 < h2 && r2 > 0.0001) {
          let r: f32 = sqrt(r2);
          let dir: vec2<f32> = diff / r;
          
          let densJ: f32 = max(densities[j], 1.0);
          let pressJ: f32 = pressures[j];
          
          let pressTerm: f32 = (pressI + pressJ) / (2.0 * densJ);
          let gradSpiky: f32 = spikyKernelGradient(r, h);
          pressureForce = pressureForce - dir * (pressTerm * gradSpiky);
          
          let velDiff: vec2<f32> = velJ - velI;
          let lapVisc: f32 = viscosityKernelLaplacian(r, h);
          viscosityForce = viscosityForce + velDiff * (params.viscosity * lapVisc / densJ);
        }
      }
    }
  }
  
  let gravity: vec2<f32> = vec2<f32>(params.gravityX, params.gravityY);
  var acceleration: vec2<f32> = pressureForce + viscosityForce + gravity;
  
  var newVel: vec2<f32> = velI + acceleration * params.timeStep;
  newVel = newVel * params.damping;
  
  var newPos: vec2<f32> = posI + newVel * params.timeStep;
  
  newPos = handleBoundaryCollisions(newPos, params);
  newPos = handleObstacles(newPos, obstacleCount, obstacles);
  newVel = (newPos - posI) / params.timeStep;
  
  positionsOut[i] = newPos;
  velocitiesOut[i] = newVel;
}
