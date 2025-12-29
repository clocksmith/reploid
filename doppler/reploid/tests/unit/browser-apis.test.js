/**
 * @fileoverview Unit tests for Browser APIs module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BrowserAPIsModule from '../../infrastructure/browser-apis.js';

describe('BrowserAPIs', () => {
  let browserApis;
  let mockUtils;
  let mockEventBus;
  let mockStateManager;

  beforeEach(() => {
    mockUtils = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    };

    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };

    mockStateManager = {
      getArtifactContent: vi.fn()
    };

    // Setup Notification mock first (needs to be available for window reference)
    global.Notification = {
      permission: 'default',
      requestPermission: vi.fn()
    };

    // Setup browser environment mocks
    global.window = {
      showDirectoryPicker: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      Notification: global.Notification  // Add reference so 'Notification' in window works
    };

    global.document = {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      documentElement: {
        requestFullscreen: vi.fn()
      },
      fullscreenElement: null,
      exitFullscreen: vi.fn()
    };

    global.navigator = {
      clipboard: {
        writeText: vi.fn(),
        readText: vi.fn()
      },
      share: vi.fn(),
      storage: {
        estimate: vi.fn(),
        persist: vi.fn()
      },
      wakeLock: {
        request: vi.fn()
      },
      permissions: {
        query: vi.fn()
      },
      vibrate: vi.fn(),
      onLine: true,
      platform: 'MacIntel',
      language: 'en-US',
      languages: ['en-US', 'en'],
      cookieEnabled: true,
      doNotTrack: null,
      deviceMemory: 8,
      hardwareConcurrency: 8
    };

    browserApis = BrowserAPIsModule.factory({
      Utils: mockUtils,
      EventBus: mockEventBus,
      StateManager: mockStateManager
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    it('detects available APIs', async () => {
      await browserApis.init();

      expect(mockUtils.logger.info).toHaveBeenCalledWith(
        '[BrowserAPIs] Initializing web API integration...'
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'browser-apis:initialized',
        expect.any(Object)
      );
    });
  });

  describe('getCapabilities', () => {
    it('returns detected capabilities', async () => {
      await browserApis.init();

      const caps = browserApis.getCapabilities();

      expect(caps).toHaveProperty('fileSystemAccess');
      expect(caps).toHaveProperty('notifications');
      expect(caps).toHaveProperty('clipboard');
      expect(caps).toHaveProperty('visibility');
      expect(caps).toHaveProperty('online');
    });
  });

  describe('Clipboard API', () => {
    it('writes to clipboard', async () => {
      await browserApis.init();
      navigator.clipboard.writeText.mockResolvedValue();

      const result = await browserApis.writeToClipboard('test text');

      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test text');
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'browser-apis:clipboard:write',
        { length: 9 }
      );
    });

    it('reads from clipboard', async () => {
      await browserApis.init();
      navigator.clipboard.readText.mockResolvedValue('clipboard content');

      const result = await browserApis.readFromClipboard();

      expect(result).toBe('clipboard content');
    });

    it('handles clipboard write failure', async () => {
      await browserApis.init();
      navigator.clipboard.writeText.mockRejectedValue(new Error('Permission denied'));

      const result = await browserApis.writeToClipboard('test');

      expect(result).toBe(false);
      expect(mockUtils.logger.error).toHaveBeenCalled();
    });
  });

  describe('Notifications API', () => {
    it('requests notification permission', async () => {
      await browserApis.init();
      Notification.requestPermission.mockResolvedValue('granted');

      const result = await browserApis.requestNotificationPermission();

      expect(result).toBe('granted');
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'browser-apis:notifications:permission',
        'granted'
      );
    });

    it('shows notification when permitted', async () => {
      // Set up Notification as a class with granted permission
      class MockNotification {
        constructor(title, options) {
          this.title = title;
          this.options = options;
        }
        static permission = 'granted';
        static requestPermission = vi.fn().mockResolvedValue('granted');
      }

      global.Notification = MockNotification;
      global.window.Notification = MockNotification;

      // Re-create browserApis with updated globals
      browserApis = BrowserAPIsModule.factory({
        Utils: mockUtils,
        EventBus: mockEventBus,
        StateManager: mockStateManager
      });

      await browserApis.init();
      // Permission is already 'granted' from init, but call to update internal state
      await browserApis.requestNotificationPermission();

      const result = await browserApis.showNotification('Test', { body: 'Body' });

      expect(result).toBe(true);
    });
  });

  describe('Storage API', () => {
    it('gets storage estimate', async () => {
      await browserApis.init();
      navigator.storage.estimate.mockResolvedValue({
        usage: 1024 * 1024 * 100, // 100MB
        quota: 1024 * 1024 * 1024 // 1GB
      });

      const result = await browserApis.getStorageEstimate();

      expect(result).toMatchObject({
        usageMB: '100.00',
        quotaMB: '1024.00',
        usagePercent: expect.any(Number)
      });
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'browser-apis:storage:estimate',
        expect.any(Object)
      );
    });

    it('requests persistent storage', async () => {
      await browserApis.init();
      navigator.storage.persist.mockResolvedValue(true);

      const result = await browserApis.requestPersistentStorage();

      expect(result).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'browser-apis:storage:persist',
        true
      );
    });
  });

  describe('Wake Lock API', () => {
    it('acquires wake lock', async () => {
      await browserApis.init();
      const mockWakeLock = {
        addEventListener: vi.fn(),
        release: vi.fn()
      };
      navigator.wakeLock.request.mockResolvedValue(mockWakeLock);

      const result = await browserApis.requestWakeLock();

      expect(result).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith('browser-apis:wakelock:acquired');
    });

    it('releases wake lock', async () => {
      await browserApis.init();
      const mockWakeLock = {
        addEventListener: vi.fn(),
        release: vi.fn().mockResolvedValue()
      };
      navigator.wakeLock.request.mockResolvedValue(mockWakeLock);

      await browserApis.requestWakeLock();
      const result = await browserApis.releaseWakeLock();

      expect(result).toBe(true);
    });
  });

  describe('Visibility API', () => {
    it('checks page visibility', async () => {
      await browserApis.init();

      const visible = browserApis.isPageVisible();

      expect(visible).toBe(true);
    });

    it('subscribes to visibility changes', async () => {
      await browserApis.init();
      const callback = vi.fn();

      const unsubscribe = browserApis.onVisibilityChange(callback);

      expect(document.addEventListener).toHaveBeenCalledWith(
        'visibilitychange',
        expect.any(Function)
      );
      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('Online Status API', () => {
    it('checks online status', async () => {
      await browserApis.init();

      const online = browserApis.isOnline();

      expect(online).toBe(true);
    });

    it('subscribes to online changes', async () => {
      await browserApis.init();
      const callback = vi.fn();

      const unsubscribe = browserApis.onOnlineChange(callback);

      expect(window.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
      expect(window.addEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('Fullscreen API', () => {
    it('requests fullscreen', async () => {
      await browserApis.init();
      document.documentElement.requestFullscreen.mockResolvedValue();

      const result = await browserApis.requestFullscreen();

      expect(result).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'browser-apis:fullscreen',
        { active: true }
      );
    });

    it('exits fullscreen', async () => {
      await browserApis.init();
      document.fullscreenElement = document.documentElement;
      document.exitFullscreen.mockResolvedValue();

      const result = await browserApis.exitFullscreen();

      expect(result).toBe(true);
    });

    it('checks fullscreen status', async () => {
      await browserApis.init();

      expect(browserApis.isFullscreen()).toBe(false);

      document.fullscreenElement = document.documentElement;
      expect(browserApis.isFullscreen()).toBe(true);
    });
  });

  describe('Permissions API', () => {
    it('queries permission status', async () => {
      await browserApis.init();
      navigator.permissions.query.mockResolvedValue({ state: 'granted' });

      const result = await browserApis.queryPermission('clipboard-read');

      expect(result).toBe('granted');
      expect(navigator.permissions.query).toHaveBeenCalledWith({ name: 'clipboard-read' });
    });

    it('handles permission query failure', async () => {
      await browserApis.init();
      navigator.permissions.query.mockRejectedValue(new Error('Not supported'));

      const result = await browserApis.queryPermission('unknown');

      expect(result).toBeNull();
    });
  });

  describe('Device Info', () => {
    it('returns device information', async () => {
      await browserApis.init();

      const info = browserApis.getDeviceInfo();

      expect(info).toMatchObject({
        memory: 8,
        cores: 8,
        platform: 'MacIntel',
        language: 'en-US',
        languages: ['en-US', 'en'],
        cookiesEnabled: true,
        online: true,
        visible: true
      });
    });
  });

  describe('Vibration API', () => {
    it('vibrates device', async () => {
      await browserApis.init();
      navigator.vibrate.mockReturnValue(true);

      const result = browserApis.vibrate(200);

      expect(result).toBe(true);
      expect(navigator.vibrate).toHaveBeenCalledWith(200);
    });

    it('accepts vibration pattern', async () => {
      await browserApis.init();
      navigator.vibrate.mockReturnValue(true);

      browserApis.vibrate([100, 50, 100]);

      expect(navigator.vibrate).toHaveBeenCalledWith([100, 50, 100]);
    });
  });

  describe('generateReport', () => {
    it('generates markdown report', async () => {
      await browserApis.init();

      const report = browserApis.generateReport();

      expect(report).toContain('# Browser API Capabilities Report');
      expect(report).toContain('## Available APIs');
      expect(report).toContain('## Device Info');
      expect(report).toContain('MacIntel');
    });
  });

  describe('Web Share API', () => {
    it('shares content', async () => {
      await browserApis.init();
      navigator.share.mockResolvedValue();

      const result = await browserApis.share({
        title: 'Test',
        text: 'Content',
        url: 'https://example.com'
      });

      expect(result).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'browser-apis:share:success',
        expect.any(Object)
      );
    });

    it('handles share cancellation', async () => {
      await browserApis.init();
      const error = new Error('Cancelled');
      error.name = 'AbortError';
      navigator.share.mockRejectedValue(error);

      const result = await browserApis.share({ title: 'Test' });

      expect(result).toBe(false);
      expect(mockUtils.logger.info).toHaveBeenCalledWith(
        '[BrowserAPIs] User cancelled share'
      );
    });
  });
});
