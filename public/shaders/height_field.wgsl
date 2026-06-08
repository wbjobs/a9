#include "common.wgsl"

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<f32>;
@group(0) @binding(3) var<storage, read_write> heightField: array<f32>;
@group(0) @binding(4) var<storage, read_write> heightFieldWeights: array<f32>;
@group(0) @binding(5) var<storage, read_write> normals: array<vec3<f32>>;
@group(0) @binding(6) var<storage, read> cellStart: array<u32>;
@group(0) @binding(7) var<storage, read> cellEnd: array<u32>;
@group(0) @binding(8) var<storage, read> particleIndices: array<u32>;

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
  let gridPos: vec2<f32> = vec2<f32>(gridX, gridY);
  
  let kernelRadius: f32 = params.smoothingRadius * 1.5;
  let kernelRadius2: f32 = kernelRadius * kernelRadius;
  let sigma: f32 = params.smoothingRadius * 0.5;
  
  let cellI: vec2<i32> = getCellIndex(gridPos, params);
  let cellRadius: i32 = i32(ceil(kernelRadius / params.gridSize)) + 1;
  
  var heightSum: f32 = 0.0;
  var weightSum: f32 = 0.0;
  
  for (var dx: i32 = -cellRadius; dx <= cellRadius; dx++) {
    for (var dy: i32 = -cellRadius; dy <= cellRadius; dy++) {
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
        let posJ: vec2<f32> = positions[j];
        let diff: vec2<f32> = gridPos - posJ;
        let r2: f32 = dot(diff, diff);
        
        if (r2 < kernelRadius2) {
          let r: f32 = sqrt(r2);
          let weight: f32 = gaussianKernel(r, sigma);
          let dens: f32 = densities[j];
          let normDens: f32 = clamp(dens / max(params.restDensity, 1.0), 0.0, 2.0);
          
          heightSum = heightSum + normDens * weight;
          weightSum = weightSum + weight;
        }
      }
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
  
  if (x > 0u) { hL = heightField[idx - 1u]; }
  if (x < res - 1u) { hR = heightField[idx + 1u]; }
  if (y > 0u) { hD = heightField[idx - res]; }
  if (y < res - 1u) { hU = heightField[idx + res]; }
  
  let dx: f32 = (hR - hL) / (2.0 * texelSizeX);
  let dy: f32 = (hU - hD) / (2.0 * texelSizeY);
  
  var nx: f32 = -dx;
  var ny: f32 = 1.0;
  var nz: f32 = -dy;
  let len: f32 = sqrt(nx * nx + ny * ny + nz * nz);
  
  if (len > 0.0001) {
    nx = nx / len;
    ny = ny / len;
    nz = nz / len;
  }
  
  nx = nx * 0.5 + 0.5;
  ny = ny * 0.5 + 0.5;
  nz = nz * 0.5 + 0.5;
  
  normals[idx] = vec3<f32>(nx, ny, nz);
}
