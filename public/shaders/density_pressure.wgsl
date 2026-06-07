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
@group(0) @binding(2) var<storage, read_write> densities: array<f32>;
@group(0) @binding(3) var<storage, read_write> pressures: array<f32>;
@group(0) @binding(4) var<storage, read> cellStart: array<i32>;
@group(0) @binding(5) var<storage, read> cellEnd: array<i32>;
@group(0) @binding(6) var<storage, read> particleIndices: array<u32>;

const PI: f32 = 3.14159265359;

fn poly6Kernel(r: f32, h: f32) -> f32 {
  if (r > h) { return 0.0; }
  let h2: f32 = h * h;
  let r2: f32 = r * r;
  let diff: f32 = h2 - r2;
  return (315.0 / (64.0 * PI * pow(h, 9.0))) * diff * diff * diff;
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
  let cellI: vec2<i32> = getCellIndex(posI);
  
  var density: f32 = 0.0;
  
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
  pressures[i] = params.pressureStiffness * max(density - params.restDensity, 0.0);
}
