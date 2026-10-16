// Compatibility URL for previously installed workers; sw.js owns bootstrap behavior.
importScripts('/sw.js' + new URL(self.location.href).search);
