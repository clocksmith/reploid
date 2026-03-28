const version = new URL(self.location.href).searchParams.get('v');
const suffix = version ? `?v=${encodeURIComponent(version)}` : '';

importScripts(`/src/self/host/sw-module-loader.js${suffix}`);
