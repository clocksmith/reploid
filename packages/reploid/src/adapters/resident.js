/** Resident execution ports; importing this entry never loads an inference runtime. */
export { createResidentExecution } from './resident-execution.js';
export { withDevice, getDeviceQueue } from './device-lane.js';
export { selectModelAdapters, createModelAdapterResolver, fetchAdapterFile } from './model-adapter.js';
