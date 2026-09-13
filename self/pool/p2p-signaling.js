export * from '../vendor/reploid/transport/signaling.js';
import { createPollingSignalingAdapter as polling, createPoolSdkSignalingAdapter as pool } from '../vendor/reploid/transport/signaling.js';
import { resolveConfig } from '../vendor/reploid/config/index.js';
const config = resolveConfig();
export const createPollingSignalingAdapter = options => polling({ config, ...options });
export const createPoolSdkSignalingAdapter = options => pool({ config, ...options });
