struct Params {
  particleCount: u32,
  smoothingRadius: f32,
  restDensity: f32,
  viscosity: f32,
  pressureStiffness: f32,
  gravityX: f32,
  gravityY: f32,
  damping: f32,
  boundaryMinX: f32,
  boundaryMaxX: f32,
  boundaryMinY: f32,
  boundaryMaxY: f32,
  timeStep: f32,
  gridSize: f32,
  gridResX: u32,
  gridResY: u32,
};

struct Obstacle {
  type: u32,
  x: f32,
  y: f32,
  radius: f32,
  width: f32,
  height: f32,
  rotation: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> densities: array<f32>;
@group(0) @binding(4) var<storage, read> pressures: array<f32>;
@group(0) @binding(5) var<storage, read_write> positionsOut: array<vec2<f32>>;
@group(0) @binding(6) var<storage, read_write> velocitiesOut: array<vec2<f32>>;
@group(0) @binding(7) var<storage, read> cellStart: array<i32>;
@group(0) @binding(8) var<storage, read> cellEnd: array<i32>;
@group(0) @binding(9) var<storage, read> particleIndices: array<u32>;
@group(0) @binding(10) var<storage, read> obstacles: array<Obstacle>;
@group(0) @binding(11) var<uniform> obstacleCount: u32;

const PI: f32 = 3.14159265359;

fn spikyKernelGradient(r: f32, h: f32) -> f32 {
  if (r > h || r < 0.0001) { return 0.0; }
  let diff: f32 = h - r;
  return (-45.0 / (PI * pow(h, 6.0))) * diff * diff;
}

fn viscosityKernelLaplacian(r: f32, h: f32) -> f32 {
  if (r > h) { return 0.0; }
  let diff: f32 = h - r;
  return (45.0 / (PI * pow(h, 6.0))) * diff;
}

fn getCellIndex(pos: vec2<f32>) -> vec2<i32> {
  let x: i32 = i32(floor((pos.x - params.boundaryMinX) / params.gridSize));
  let y: i32 = i32(floor((pos.y - params.boundaryMinY) / params.gridSize));
  return vec2<i32>(clamp(x, 0, i32(params.gridResX) - 1), clamp(y, 0, i32(params.gridResY) - 1));
}

fn getCellHash(cell: vec2<i32>) -> u32 {
  return u32(cell.y) * params.gridResX + u32(cell.x);
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
  let cellI: vec2<i32> = getCellIndex(posI);
  
  var pressureForce: vec2<f32> = vec2<f32>(0.0);
  var viscosityForce: vec2<f32> = vec2<f32>(0.0);
  
  for (var dx: i32 = -1; dx <= 1; dx = dx + 1) {
    for (var dy: i32 = -1; dy <= 1; dy = dy + 1) {
      let neighborCell: vec2<i32> = cellI + vec2<i32>(dx, dy);
      if (neighborCell.x < 0 || neighborCell.x >= i32(params.gridResX) ||
          neighborCell.y < 0 || neighborCell.y >= i32(params.gridResY)) {
        continue;
      }
      
      let cellHash: u32 = getCellHash(neighborCell);
      let start: i32 = cellStart[cellHash];
      if (start == -1) { continue; }
      
      let end: i32 = cellEnd[cellHash];
      
      for (var k: i32 = start; k < end; k = k + 1) {
        let j: u32 = particleIndices[u32(k)];
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
          pressureForce = pressureForce - pressTerm * spikyKernelGradient(r, h) * dir;
          
          let velDiff: vec2<f32> = velJ - velI;
          viscosityForce = viscosityForce + params.viscosity * (velDiff / densJ) * viscosityKernelLaplacian(r, h);
        }
      }
    }
  }
  
  let gravity: vec2<f32> = vec2<f32>(params.gravityX, params.gravityY);
  var acceleration: vec2<f32> = (pressureForce + viscosityForce) + gravity;
  
  var newVel: vec2<f32> = velI + acceleration * params.timeStep;
  newVel = newVel * params.damping;
  
  var newPos: vec2<f32> = posI + newVel * params.timeStep;
  
  newPos = handleBoundaryCollisions(newPos);
  newPos = handleObstacles(newPos);
  newVel = (newPos - posI) / params.timeStep;
  
  positionsOut[i] = newPos;
  velocitiesOut[i] = newVel;
}

fn handleBoundaryCollisions(pos: vec2<f32>) -> vec2<f32> {
  var result: vec2<f32> = pos;
  let margin: f32 = 5.0;
  
  result.x = clamp(result.x, params.boundaryMinX + margin, params.boundaryMaxX - margin);
  result.y = clamp(result.y, params.boundaryMinY + margin, params.boundaryMaxY - margin);
  
  return result;
}

fn handleObstacles(pos: vec2<f32>) -> vec2<f32> {
  var result: vec2<f32> = pos;
  
  for (var i: u32 = 0; i < obstacleCount; i = i + 1) {
    let obs: Obstacle = obstacles[i];
    
    if (obs.type == 0) {
      let diff: vec2<f32> = result - vec2<f32>(obs.x, obs.y);
      let dist: f32 = length(diff);
      let minDist: f32 = obs.radius + 8.0;
      
      if (dist < minDist) {
        let dir: vec2<f32> = normalize(diff + vec2<f32>(0.0001, 0.0001));
        result = vec2<f32>(obs.x, obs.y) + dir * minDist;
      }
    } else if (obs.type == 2) {
      let halfW: f32 = obs.width * 0.5;
      let halfH: f32 = obs.height * 0.5;
      let cosR: f32 = cos(-obs.rotation);
      let sinR: f32 = sin(-obs.rotation);
      
      let localX: f32 = cosR * (result.x - obs.x) - sinR * (result.y - obs.y);
      let localY: f32 = sinR * (result.x - obs.x) + cosR * (result.y - obs.y);
      
      let clampedX: f32 = clamp(localX, -halfW, halfW);
      let clampedY: f32 = clamp(localY, -halfH, halfH);
      
      let dx: f32 = localX - clampedX;
      let dy: f32 = localY - clampedY;
      let distSq: f32 = dx * dx + dy * dy;
      
      if (distSq < 64.0) {
        let dist: f32 = sqrt(max(distSq, 0.0001));
        var pushDir: vec2<f32> = vec2<f32>(dx, dy) / dist;
        
        if (distSq < 0.0001) {
          let absX: f32 = abs(localX) / halfW;
          let absY: f32 = abs(localY) / halfH;
          if (absX > absY) {
            pushDir = vec2<f32>(sign(localX), 0.0);
          } else {
            pushDir = vec2<f32>(0.0, sign(localY));
          }
        }
        
        let worldDirX: f32 = cos(obs.rotation) * pushDir.x - sin(obs.rotation) * pushDir.y;
        let worldDirY: f32 = sin(obs.rotation) * pushDir.x + cos(obs.rotation) * pushDir.y;
        
        result = result + vec2<f32>(worldDirX, worldDirY) * (8.0 - dist);
      }
    }
  }
  
  return result;
}
