/** Browser and native hosts use the library's single device-lifetime owner. */
export { withDevice as withWorkDevice, getDeviceQueue as getWorkDeviceQueue }
  from '../../../shared/vendor/reploid/adapters/resident.js';
