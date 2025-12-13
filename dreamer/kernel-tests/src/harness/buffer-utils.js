/**
 * GPU Buffer Utilities
 */

/**
 * Create a GPU buffer from typed array data
 * @param {GPUDevice} device
 * @param {Float32Array|Uint32Array|Int32Array} data
 * @param {string} usage - 'read', 'write', or 'readwrite'
 * @returns {GPUBuffer}
 */
export function createBuffer(device, data, usage = 'read') {
  let gpuUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;

  if (usage === 'read' || usage === 'readwrite') {
    gpuUsage |= GPUBufferUsage.COPY_DST;
  }

  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: gpuUsage,
    mappedAtCreation: true,
  });

  // Copy data
  const arrayType = data.constructor;
  new arrayType(buffer.getMappedRange()).set(data);
  buffer.unmap();

  return buffer;
}

/**
 * Create an empty GPU buffer
 * @param {GPUDevice} device
 * @param {number} size - Size in bytes
 * @param {string} usage
 * @returns {GPUBuffer}
 */
export function createEmptyBuffer(device, size, usage = 'readwrite') {
  let gpuUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

  return device.createBuffer({
    size,
    usage: gpuUsage,
  });
}

/**
 * Read data back from GPU buffer
 * @param {GPUDevice} device
 * @param {GPUBuffer} buffer
 * @param {number} size - Size in bytes to read
 * @returns {Promise<ArrayBuffer>}
 */
export async function readGPUBuffer(device, buffer, size) {
  // Create staging buffer for readback
  const stagingBuffer = device.createBuffer({
    size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // Copy from GPU buffer to staging
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, stagingBuffer, 0, size);
  device.queue.submit([encoder.finish()]);

  // Wait for GPU work to complete
  await device.queue.onSubmittedWorkDone();

  // Map and read
  await stagingBuffer.mapAsync(GPUMapMode.READ);
  const copyArrayBuffer = stagingBuffer.getMappedRange().slice(0);
  stagingBuffer.unmap();
  stagingBuffer.destroy();

  return copyArrayBuffer;
}

/**
 * Read GPU buffer as Float32Array
 * @param {GPUDevice} device
 * @param {GPUBuffer} buffer
 * @param {number} numElements
 * @returns {Promise<Float32Array>}
 */
export async function readAsFloat32(device, buffer, numElements) {
  const arrayBuffer = await readGPUBuffer(device, buffer, numElements * 4);
  return new Float32Array(arrayBuffer);
}

/**
 * Read GPU buffer as Uint32Array
 * @param {GPUDevice} device
 * @param {GPUBuffer} buffer
 * @param {number} numElements
 * @returns {Promise<Uint32Array>}
 */
export async function readAsUint32(device, buffer, numElements) {
  const arrayBuffer = await readGPUBuffer(device, buffer, numElements * 4);
  return new Uint32Array(arrayBuffer);
}

/**
 * Upload data to existing GPU buffer
 * @param {GPUDevice} device
 * @param {GPUBuffer} buffer
 * @param {Float32Array|Uint32Array} data
 * @param {number} offset - Byte offset in buffer
 */
export function uploadToBuffer(device, buffer, data, offset = 0) {
  device.queue.writeBuffer(buffer, offset, data);
}

/**
 * Clear a GPU buffer to zeros
 * @param {GPUDevice} device
 * @param {GPUBuffer} buffer
 * @param {number} size - Size in bytes
 */
export function clearBuffer(device, buffer, size) {
  const encoder = device.createCommandEncoder();
  encoder.clearBuffer(buffer, 0, size);
  device.queue.submit([encoder.finish()]);
}
