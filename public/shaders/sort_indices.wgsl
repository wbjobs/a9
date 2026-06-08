#include "common.wgsl"

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read_write> cellCounters: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> particleIndices: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let i: u32 = globalId.x;
  if (i >= params.particleCount) { return; }

  let pos: vec2<f32> = positions[i];
  let cell: vec2<i32> = getCellIndex(pos, params);
  let hash: u32 = getCellHash(cell, params);
  
  let start: u32 = cellStart[hash];
  let offset: u32 = atomicAdd(&cellCounters[hash], 1u);
  let index: u32 = start + offset;
  
  if (index < params.particleCount) {
    particleIndices[index] = i;
  }
}
