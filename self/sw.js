const version = new URL(self.location.href).searchParams.get('v');
const suffix = version ? `?v=${encodeURIComponent(version)}` : '';

importScripts(`/host/sw-module-loader.js${suffix}`);
