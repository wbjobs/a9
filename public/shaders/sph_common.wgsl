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
};

struct Particle {
  position: vec2<f32>,
  velocity: vec2<f32>,
  density: f32,
  pressure: f32,
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
@group(0) @binding(1) var<storage, read> positionsIn: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> velocitiesIn: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> densities: array<f32>;
@group(0) @binding(4) var<storage, read_write> pressures: array<f32>>;
@group(0) @binding(5) var<storage, read_write> positionsOut: array<vec2<f32>>;
@group(0) @binding(6) var<storage, read_write> velocitiesOut: array<vec2<f32>>;
@group(0) @binding(7) var<storage, read> obstacles: array<Obstacle>;
@group(0) @binding(8) var<uniform> obstacleCount: u32;

const PI: f32 = 3.14159265359;

fn poly6Kernel(r: f32, h: f32) -> f32 {
  if (r > h) { return 0.0; }
  let h2: f32 = h * h;
  let r2: f32 = r * r;
  let diff: f32 = h2 - r2;
  return (315.0 / (64.0 * PI * pow(h, 9.0))) * diff * diff * diff;
}

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

fn computeDensityPressure(i: u32) {
  let h: f32 = params.smoothingRadius;
  let h2: f32 = h * h;
  let posI: vec2<f32> = positionsIn[i];
  
  var density: f32 = 0.0;
  
  for (var j: u32 = 0; j < params.particleCount; j = j + 1) {
    let posJ: vec2<f32> = positionsIn[j];
    let diff: vec2<f32> = posI - posJ;
    let r2: f32 = dot(diff, diff);
    
    if (r2 < h2) {
      let r: f32 = sqrt(r2);
      density = density + poly6Kernel(r, h);
    }
  }
  
  densities[i] = density;
  pressures[i] = params.pressureStiffness * (density - params.restDensity);
}

fn computeForcesAndIntegrate(i: u32) {
  let h: f32 = params.smoothingRadius;
  let h2: f32 = h * h;
  let posI: vec2<f32> = positionsIn[i];
  let velI: vec2<f32> = velocitiesIn[i];
  let densI: f32 = max(densities[i], 1.0);
  let pressI: f32 = pressures[i];
  
  var pressureForce: vec2<f32> = vec2<f32>(0.0);
  var viscosityForce: vec2<f32> = vec2<f32>(0.0);
  
  for (var j: u32 = 0; j < params.particleCount; j = j + 1) {
    if (i == j) { continue; }
    
    let posJ: vec2<f32> = positionsIn[j];
    let velJ: vec2<f32> = velocitiesIn[j];
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
  
  let gravity: vec2<f32> = vec2<f32>(params.gravityX, params.gravityY);
  var acceleration: vec2<f32> = (pressureForce + viscosityForce) + gravity;
  
  var newVel: vec2<f32> = velI + acceleration * params.timeStep;
  newVel = newVel * params.damping;
  
  var newPos: vec2<f32> = posI + newVel * params.timeStep;
  
  newPos = handleCollisions(newPos, newVel);
  newPos = handleObstacles(newPos, newVel);
  newVel = (newPos - posI) / params.timeStep;
  
  positionsOut[i] = newPos;
  velocitiesOut[i] = newVel;
}

fn handleCollisions(pos: vec2<f32>, vel: vec2<f32>) -> vec2<f32> {
  var result: vec2<f32> = pos;
  let margin: f32 = 5.0;
  
  if (result.x < params.boundaryMinX + margin) {
    result.x = params.boundaryMinX + margin;
  }
  if (result.x > params.boundaryMaxX - margin) {
    result.x = params.boundaryMaxX - margin;
  }
  if (result.y < params.boundaryMinY + margin) {
    result.y = params.boundaryMinY + margin;
  }
  if (result.y > params.boundaryMaxY - margin) {
    result.y = params.boundaryMaxY - margin;
  }
  
  return result;
}

fn handleObstacles(pos: vec2<f32>, vel: vec2<f32>) -> vec2<f32> {
  var result: vec2<f32> = pos;
  
  for (var i: u32 = 0; i < obstacleCount; i = i + 1) {
    let obs: Obstacle = obstacles[i];
    
    if (obs.type == 0) {
      let diff: vec2<f32> = result - vec2<f32>(obs.x, obs.y);
      let dist: f32 = length(diff);
      let minDist: f32 = obs.radius + 8.0;
      
      if (dist < minDist) {
        let dir: vec2<f32> = normalize(diff + vec2<f32>(0.0001));
        result = vec2<f32>(obs.x, obs.y) + dir * minDist;
      }
    }
  }
  
  return result;
}
