import policy from './gpu-signature.policy.json' with { type: 'json' };

// Atomic tickets record relative completion order, without a GPU timestamp query.
// No inter-workgroup waiting: every workgroup completes independently.
export const gpuSignatureShader = `
@group(0) @binding(0) var<uniform> params: vec4u;
@group(0) @binding(1) var<storage, read> data: array<u32>;
@group(0) @binding(2) var<storage, read_write> result: array<atomic<u32>>;
var<workgroup> laneValues: array<u32, ${policy.lanes}>;
@compute @workgroup_size(${policy.lanes})
fn main(@builtin(workgroup_id) group: vec3u, @builtin(local_invocation_index) lane: u32) {
  var value = params.x ^ (group.x * 747796405u) ^ lane;
  for (var i = 0u; i < ${policy.iterations}u; i++) {
    value = value * 1664525u + 1013904223u;
    if (params.y == 1u) { value = value ^ data[value & ${policy.dataWords - 1}u]; }
    value = value ^ (value >> 16u);
  }
  laneValues[lane] = value;
  workgroupBarrier();
  if (lane == 0u) {
    var checksum = 0u;
    for (var i = 0u; i < ${policy.lanes}u; i++) { checksum = checksum ^ laneValues[i]; }
    let ticket = atomicAdd(&result[0], 1u);
    atomicStore(&result[1u + group.x], ticket);
    atomicStore(&result[1u + ${policy.workgroups}u + group.x], checksum);
  }
}`;
