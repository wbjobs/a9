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

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> cellCounts: array<u32>;

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

  let pos: vec2<f32> = positions[i];
  let cell: vec2<i32> = getCellIndex(pos);
  let hash: u32 = getCellHash(cell);
  
  atomicAdd(&cellCounts[hash], 1u);
}
