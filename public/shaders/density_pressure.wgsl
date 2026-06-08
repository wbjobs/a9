#include "common.wgsl"

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> densities: array<f32>;
@group(0) @binding(3) var<storage, read_write> pressures: array<f32>;
@group(0) @binding(4) var<storage, read> cellStart: array<u32>;
@group(0) @binding(5) var<storage, read> cellEnd: array<u32>;
@group(0) @binding(6) var<storage, read> particleIndices: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let i: u32 = globalId.x;
  if (i >= params.particleCount) { return; }

  let h: f32 = params.smoothingRadius;
  let h2: f32 = h * h;
  let posI: vec2<f32> = positions[i];
  let cellI: vec2<i32> = getCellIndex(posI, params);
  
  var density: f32 = 0.0;
  
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
        let posJ: vec2<f32> = positions[j];
        let diff: vec2<f32> = posI - posJ;
        let r2: f32 = dot(diff, diff);
        
        if (r2 < h2) {
          let r: f32 = sqrt(r2);
          density = density + poly6Kernel(r, h);
        }
      }
    }
  }
  
  densities[i] = density;
  let pressureDiff: f32 = density - params.restDensity;
  pressures[i] = params.pressureStiffness * max(pressureDiff, 0.0);
}
