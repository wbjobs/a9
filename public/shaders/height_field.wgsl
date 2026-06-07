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
  heightFieldRes: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<f32>;
@group(0) @binding(3) var<storage, read_write> heightField: array<f32>;
@group(0) @binding(4) var<storage, read_write> heightFieldWeights: array<f32>;
@group(0) @binding(5) var<storage, read_write> normals: array<vec3<f32>>;

const PI: f32 = 3.14159265359;

fn gaussianKernel(r: f32, sigma: f32) -> f32 {
  let sigma2: f32 = sigma * sigma;
  return exp(-r * r / (2.0 * sigma2)) / (2.0 * PI * sigma2);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let x: u32 = globalId.x;
  let y: u32 = globalId.y;
  let res: u32 = params.heightFieldRes;
  
  if (x >= res || y >= res) { return; }
  
  let idx: u32 = y * res + x;
  
  let domainWidth: f32 = params.boundaryMaxX - params.boundaryMinX;
  let domainHeight: f32 = params.boundaryMaxY - params.boundaryMinY;
  
  let gridX: f32 = params.boundaryMinX + (f32(x) + 0.5) * domainWidth / f32(res);
  let gridY: f32 = params.boundaryMinY + (f32(y) + 0.5) * domainHeight / f32(res);
  
  let kernelRadius: f32 = params.smoothingRadius * 1.5;
  let kernelRadius2: f32 = kernelRadius * kernelRadius;
  
  var heightSum: f32 = 0.0;
  var weightSum: f32 = 0.0;
  
  for (var i: u32 = 0; i < params.particleCount; i = i + 1) {
    let pos: vec2<f32> = positions[i];
    let diff: vec2<f32> = vec2<f32>(gridX, gridY) - pos;
    let r2: f32 = dot(diff, diff);
    
    if (r2 < kernelRadius2) {
      let r: f32 = sqrt(r2);
      let weight: f32 = gaussianKernel(r, params.smoothingRadius * 0.5);
      let dens: f32 = densities[i];
      let normDens: f32 = clamp(dens / max(params.restDensity, 1.0), 0.0, 2.0);
      
      heightSum = heightSum + normDens * weight;
      weightSum = weightSum + weight;
    }
  }
  
  if (weightSum > 0.0001) {
    heightField[idx] = heightSum / weightSum * 50.0;
  } else {
    heightField[idx] = 0.0;
  }
  
  heightFieldWeights[idx] = weightSum;
}

@compute @workgroup_size(16, 16)
fn computeNormals(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let x: u32 = globalId.x;
  let y: u32 = globalId.y;
  let res: u32 = params.heightFieldRes;
  
  if (x >= res || y >= res) { return; }
  
  let idx: u32 = y * res + x;
  let domainWidth: f32 = params.boundaryMaxX - params.boundaryMinX;
  let domainHeight: f32 = params.boundaryMaxY - params.boundaryMinY;
  
  let texelSizeX: f32 = domainWidth / f32(res);
  let texelSizeY: f32 = domainHeight / f32(res);
  
  var hL: f32 = 0.0;
  var hR: f32 = 0.0;
  var hD: f32 = 0.0;
  var hU: f32 = 0.0;
  
  if (x > 0) { hL = heightField[idx - 1]; }
  if (x < res - 1) { hR = heightField[idx + 1]; }
  if (y > 0) { hD = heightField[idx - res]; }
  if (y < res - 1) { hU = heightField[idx + res]; }
  
  let dx: f32 = (hR - hL) / (2.0 * texelSizeX);
  let dy: f32 = (hU - hD) / (2.0 * texelSizeY);
  
  var normal: vec3<f32> = normalize(vec3<f32>(-dx, 1.0, -dy));
  normal = normal * 0.5 + 0.5;
  
  normals[idx] = normal;
}
