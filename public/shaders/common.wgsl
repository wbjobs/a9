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

struct Obstacle {
  type: u32,
  x: f32,
  y: f32,
  radius: f32,
  width: f32,
  height: f32,
  rotation: f32,
};

const PI: f32 = 3.141592653589793;

fn poly6Kernel(r: f32, h: f32) -> f32 {
  if (r > h) { return 0.0; }
  let h2: f32 = h * h;
  let h4: f32 = h2 * h2;
  let h6: f32 = h4 * h2;
  let h9: f32 = h6 * h2 * h;
  let r2: f32 = r * r;
  let diff: f32 = h2 - r2;
  let diff3: f32 = diff * diff * diff;
  return (315.0 / (64.0 * PI * h9)) * diff3;
}

fn spikyKernelGradient(r: f32, h: f32) -> f32 {
  if (r > h || r < 0.0001) { return 0.0; }
  let h2: f32 = h * h;
  let h3: f32 = h2 * h;
  let h6: f32 = h3 * h3;
  let diff: f32 = h - r;
  let diff2: f32 = diff * diff;
  return (-45.0 / (PI * h6)) * diff2;
}

fn viscosityKernelLaplacian(r: f32, h: f32) -> f32 {
  if (r > h) { return 0.0; }
  let h2: f32 = h * h;
  let h3: f32 = h2 * h;
  let h6: f32 = h3 * h3;
  let diff: f32 = h - r;
  return (45.0 / (PI * h6)) * diff;
}

fn gaussianKernel(r: f32, sigma: f32) -> f32 {
  let sigma2: f32 = sigma * sigma;
  let sigma2x2: f32 = sigma2 * 2.0;
  return exp(-r * r / sigma2x2) / (PI * sigma2x2);
}

fn getCellIndex(pos: vec2<f32>, params: Params) -> vec2<i32> {
  let offsetX: f32 = pos.x - params.boundaryMinX;
  let offsetY: f32 = pos.y - params.boundaryMinY;
  let fx: f32 = floor(offsetX / params.gridSize);
  let fy: f32 = floor(offsetY / params.gridSize);
  let cx: i32 = i32(fx);
  let cy: i32 = i32(fy);
  let maxX: i32 = i32(params.gridResX) - 1;
  let maxY: i32 = i32(params.gridResY) - 1;
  return vec2<i32>(clamp(cx, 0, maxX), clamp(cy, 0, maxY));
}

fn getCellHash(cell: vec2<i32>, params: Params) -> u32 {
  return u32(cell.y) * params.gridResX + u32(cell.x);
}
