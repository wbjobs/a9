@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<storage, read_write> blockSums: array<u32>;

var<workgroup> sharedMem: array<u32, 1024>;

@compute @workgroup_size(512)
fn scanBlock(@builtin(global_invocation_id) globalId: vec3<u32>,
             @builtin(local_invocation_id) localId: vec3<u32>,
             @builtin(workgroup_id) workgroupId: vec3<u32>) {
  let n: u32 = arrayLength(&input);
  let blockSize: u32 = 1024u;
  let blockStart: u32 = workgroupId.x * blockSize;
  
  var loadIdx1: u32 = blockStart + localId.x;
  var loadIdx2: u32 = blockStart + localId.x + 512u;
  
  if (loadIdx1 < n) {
    sharedMem[localId.x] = input[loadIdx1];
  } else {
    sharedMem[localId.x] = 0u;
  }
  
  if (loadIdx2 < n) {
    sharedMem[localId.x + 512u] = input[loadIdx2];
  } else {
    sharedMem[localId.x + 512u] = 0u;
  }
  
  workgroupBarrier();
  
  for (var step: u32 = 1u; step <= 512u; step = step * 2u) {
    var prev: u32 = 0u;
    if (localId.x >= step) {
      prev = sharedMem[localId.x - step + 512u];
    }
    workgroupBarrier();
    if (localId.x >= step) {
      sharedMem[localId.x + 512u] = sharedMem[localId.x + 512u] + prev;
    }
    workgroupBarrier();
  }
  
  if (localId.x == 0u) {
    blockSums[workgroupId.x] = sharedMem[1023u];
    sharedMem[1023u] = 0u;
  }
  workgroupBarrier();
  
  for (var step: u32 = 512u; step >= 1u; step = step / 2u) {
    var prev: u32 = 0u;
    if (localId.x >= step) {
      prev = sharedMem[localId.x - step + 512u];
    }
    workgroupBarrier();
    if (localId.x >= step) {
      sharedMem[localId.x + 512u] = sharedMem[localId.x + 512u] + prev;
    }
    workgroupBarrier();
  }
  
  if (loadIdx1 < n) {
    output[loadIdx1] = sharedMem[localId.x + 512u];
  }
  if (loadIdx2 < n) {
    output[loadIdx2] = sharedMem[localId.x + 512u + 512u];
  }
}

@compute @workgroup_size(512)
fn addBlockSums(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let n: u32 = arrayLength(&output);
  let blockSize: u32 = 1024u;
  let blockIdx: u32 = globalId.x / blockSize;
  
  if (globalId.x >= n || blockIdx == 0u) {
    return;
  }
  
  var sum: u32 = 0u;
  for (var i: u32 = 0u; i < blockIdx; i = i + 1u) {
    sum = sum + blockSums[i];
  }
  
  output[globalId.x] = output[globalId.x] + sum;
}
