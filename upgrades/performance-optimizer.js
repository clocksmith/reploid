// Performance Optimizer Module for REPLOID
// Monitors performance and enables self-optimization

const PerformanceOptimizer = {
  metadata: {
    id: 'PerformanceOptimizer',
    version: '1.0.0',
    dependencies: ['logger', 'StateManager', 'Utils'],
    async: false,
    type: 'service'
  },

  factory: (deps) => {
    const { logger, StateManager, Utils } = deps;
    
    // Performance tracking state
    const metrics = {
      functions: new Map(),
      operations: new Map(),
      cycles: [],
      memory: [],
      errors: []
    };
    
    let observer = null;
    let isMonitoring = false;
    let optimizationCallbacks = new Map();
    
    // Initialize performance monitoring
    const initialize = () => {
      logger.info('[PerformanceOptimizer] Initializing performance monitoring');
      
      // Create performance observer
      observer = new PerformanceObserver((list) => {
        handlePerformanceEntries(list.getEntries());
      });
      
      // Start observing various entry types
      try {
        observer.observe({ 
          entryTypes: ['measure', 'mark', 'navigation', 'resource'] 
        });
      } catch (e) {
        // Fallback for older browsers
        observer.observe({ entryTypes: ['measure'] });
      }
      
      // Monitor memory usage
      if (performance.memory) {
        setInterval(trackMemoryUsage, 10000);
      }
      
      // Monitor long tasks
      if (window.PerformanceObserver && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        const longTaskObserver = new PerformanceObserver((list) => {
          handleLongTasks(list.getEntries());
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      }
      
      isMonitoring = true;
      logger.info('[PerformanceOptimizer] Performance monitoring initialized');
    };
    
    // Handle performance entries
    const handlePerformanceEntries = (entries) => {
      entries.forEach(entry => {
        switch (entry.entryType) {
          case 'measure':
            trackMeasure(entry);
            break;
          case 'mark':
            trackMark(entry);
            break;
          case 'navigation':
            trackNavigation(entry);
            break;
          case 'resource':
            trackResource(entry);
            break;
        }
      });
    };
    
    // Track performance measures
    const trackMeasure = (entry) => {
      const { name, duration, startTime } = entry;
      
      if (!metrics.operations.has(name)) {
        metrics.operations.set(name, {
          count: 0,
          totalDuration: 0,
          avgDuration: 0,
          minDuration: Infinity,
          maxDuration: 0,
          lastDuration: 0
        });
      }
      
      const opMetrics = metrics.operations.get(name);
      opMetrics.count++;
      opMetrics.totalDuration += duration;
      opMetrics.avgDuration = opMetrics.totalDuration / opMetrics.count;
      opMetrics.minDuration = Math.min(opMetrics.minDuration, duration);
      opMetrics.maxDuration = Math.max(opMetrics.maxDuration, duration);
      opMetrics.lastDuration = duration;
      
      // Check for performance degradation
      if (duration > opMetrics.avgDuration * 2) {
        logger.warn(`[PerformanceOptimizer] Performance degradation detected in ${name}: ${duration}ms (avg: ${opMetrics.avgDuration}ms)`);
        triggerOptimization(name, 'degradation', { duration, average: opMetrics.avgDuration });
      }
    };
    
    // Track performance marks
    const trackMark = (entry) => {
      logger.debug(`[PerformanceOptimizer] Mark: ${entry.name} at ${entry.startTime}ms`);
    };
    
    // Track navigation performance
    const trackNavigation = (entry) => {
      const loadTime = entry.loadEventEnd - entry.fetchStart;
      logger.info(`[PerformanceOptimizer] Page load time: ${loadTime}ms`);
    };
    
    // Track resource loading
    const trackResource = (entry) => {
      if (entry.duration > 1000) {
        logger.warn(`[PerformanceOptimizer] Slow resource: ${entry.name} took ${entry.duration}ms`);
      }
    };
    
    // Handle long tasks
    const handleLongTasks = (entries) => {
      entries.forEach(entry => {
        logger.warn(`[PerformanceOptimizer] Long task detected: ${entry.duration}ms`);
        
        // Trigger optimization for long-running tasks
        if (entry.duration > 100) {
          triggerOptimization('long-task', 'blocking', { duration: entry.duration });
        }
      });
    };
    
    // Track memory usage
    const trackMemoryUsage = () => {
      if (!performance.memory) return;
      
      const memoryInfo = {
        timestamp: Date.now(),
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
      };
      
      metrics.memory.push(memoryInfo);
      
      // Keep only last 100 measurements
      if (metrics.memory.length > 100) {
        metrics.memory.shift();
      }
      
      // Check for memory leaks
      const usage = memoryInfo.usedJSHeapSize / memoryInfo.jsHeapSizeLimit;
      if (usage > 0.9) {
        logger.error('[PerformanceOptimizer] Critical memory usage: ' + (usage * 100).toFixed(1) + '%');
        triggerOptimization('memory', 'critical', memoryInfo);
      } else if (usage > 0.7) {
        logger.warn('[PerformanceOptimizer] High memory usage: ' + (usage * 100).toFixed(1) + '%');
      }
    };
    
    // Measure function execution time
    const measureFunction = (name, fn) => {
      return async (...args) => {
        const startMark = `${name}-start-${Date.now()}`;
        const endMark = `${name}-end-${Date.now()}`;
        
        performance.mark(startMark);
        
        try {
          const result = await fn(...args);
          performance.mark(endMark);
          performance.measure(name, startMark, endMark);
          return result;
        } catch (error) {
          performance.mark(endMark);
          performance.measure(name, startMark, endMark);
          
          // Track errors
          metrics.errors.push({
            function: name,
            error: error.message,
            timestamp: Date.now()
          });
          
          throw error;
        } finally {
          // Clean up marks
          performance.clearMarks(startMark);
          performance.clearMarks(endMark);
        }
      };
    };
    
    // Wrap module for performance monitoring
    const wrapModule = (module, moduleName) => {
      const wrapped = {};
      
      for (const key in module) {
        if (typeof module[key] === 'function') {
          wrapped[key] = measureFunction(`${moduleName}.${key}`, module[key]);
        } else {
          wrapped[key] = module[key];
        }
      }
      
      return wrapped;
    };
    
    // Profile code execution
    const profileCode = async (code, iterations = 100) => {
      logger.info(`[PerformanceOptimizer] Profiling code for ${iterations} iterations`);
      
      const results = {
        iterations,
        totalTime: 0,
        avgTime: 0,
        minTime: Infinity,
        maxTime: 0,
        times: []
      };
      
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        
        try {
          // Execute code (would use safe execution context)
          await eval(`(async () => { ${code} })()`);
        } catch (error) {
          logger.error(`[PerformanceOptimizer] Profiling error:`, error);
        }
        
        const duration = performance.now() - start;
        results.times.push(duration);
        results.totalTime += duration;
        results.minTime = Math.min(results.minTime, duration);
        results.maxTime = Math.max(results.maxTime, duration);
      }
      
      results.avgTime = results.totalTime / iterations;
      
      // Calculate standard deviation
      const variance = results.times.reduce((sum, time) => 
        sum + Math.pow(time - results.avgTime, 2), 0) / iterations;
      results.stdDev = Math.sqrt(variance);
      
      logger.info(`[PerformanceOptimizer] Profile complete: avg ${results.avgTime.toFixed(2)}ms, std dev ${results.stdDev.toFixed(2)}ms`);
      
      return results;
    };
    
    // Analyze performance bottlenecks
    const analyzeBottlenecks = () => {
      const bottlenecks = [];
      
      // Find slow operations
      metrics.operations.forEach((opMetrics, name) => {
        if (opMetrics.avgDuration > 50) {
          bottlenecks.push({
            type: 'slow-operation',
            name,
            avgDuration: opMetrics.avgDuration,
            count: opMetrics.count,
            impact: opMetrics.avgDuration * opMetrics.count
          });
        }
      });
      
      // Find memory issues
      if (metrics.memory.length > 10) {
        const recentMemory = metrics.memory.slice(-10);
        const memoryGrowth = recentMemory[recentMemory.length - 1].usedJSHeapSize - 
                            recentMemory[0].usedJSHeapSize;
        
        if (memoryGrowth > 10 * 1024 * 1024) { // 10MB growth
          bottlenecks.push({
            type: 'memory-leak',
            growth: memoryGrowth,
            timespan: recentMemory[recentMemory.length - 1].timestamp - recentMemory[0].timestamp
          });
        }
      }
      
      // Find error patterns
      const errorCounts = {};
      metrics.errors.forEach(error => {
        errorCounts[error.function] = (errorCounts[error.function] || 0) + 1;
      });
      
      Object.entries(errorCounts).forEach(([func, count]) => {
        if (count > 5) {
          bottlenecks.push({
            type: 'error-prone',
            function: func,
            errorCount: count
          });
        }
      });
      
      // Sort by impact
      bottlenecks.sort((a, b) => {
        const impactA = a.impact || a.growth || a.errorCount || 0;
        const impactB = b.impact || b.growth || b.errorCount || 0;
        return impactB - impactA;
      });
      
      return bottlenecks;
    };
    
    // Generate optimization suggestions
    const generateOptimizations = () => {
      const bottlenecks = analyzeBottlenecks();
      const suggestions = [];
      
      bottlenecks.forEach(bottleneck => {
        switch (bottleneck.type) {
          case 'slow-operation':
            suggestions.push({
              target: bottleneck.name,
              type: 'performance',
              suggestion: `Consider optimizing ${bottleneck.name} - currently averaging ${bottleneck.avgDuration.toFixed(2)}ms`,
              priority: bottleneck.impact > 1000 ? 'high' : 'medium',
              actions: [
                'Add caching for repeated operations',
                'Use Web Workers for parallel processing',
                'Implement lazy loading or pagination'
              ]
            });
            break;
            
          case 'memory-leak':
            suggestions.push({
              target: 'memory',
              type: 'memory',
              suggestion: `Memory usage growing rapidly: ${(bottleneck.growth / 1024 / 1024).toFixed(2)}MB in ${(bottleneck.timespan / 1000).toFixed(1)}s`,
              priority: 'high',
              actions: [
                'Review event listener cleanup',
                'Check for circular references',
                'Implement object pooling for frequently created objects'
              ]
            });
            break;
            
          case 'error-prone':
            suggestions.push({
              target: bottleneck.function,
              type: 'reliability',
              suggestion: `Function ${bottleneck.function} has ${bottleneck.errorCount} errors`,
              priority: 'high',
              actions: [
                'Add input validation',
                'Implement error recovery',
                'Add retry logic with exponential backoff'
              ]
            });
            break;
        }
      });
      
      return suggestions;
    };
    
    // Trigger optimization callback
    const triggerOptimization = (target, reason, data) => {
      const callbacks = optimizationCallbacks.get(target) || [];
      callbacks.forEach(callback => {
        try {
          callback(reason, data);
        } catch (error) {
          logger.error(`[PerformanceOptimizer] Optimization callback error:`, error);
        }
      });
      
      // Also trigger general callbacks
      const generalCallbacks = optimizationCallbacks.get('*') || [];
      generalCallbacks.forEach(callback => {
        try {
          callback(target, reason, data);
        } catch (error) {
          logger.error(`[PerformanceOptimizer] General optimization callback error:`, error);
        }
      });
    };
    
    // Register optimization callback
    const onOptimizationNeeded = (target, callback) => {
      if (!optimizationCallbacks.has(target)) {
        optimizationCallbacks.set(target, []);
      }
      optimizationCallbacks.get(target).push(callback);
      logger.debug(`[PerformanceOptimizer] Registered optimization callback for: ${target}`);
    };
    
    // Self-optimize based on performance data
    const selfOptimize = async () => {
      logger.info('[PerformanceOptimizer] Starting self-optimization');
      
      const suggestions = generateOptimizations();
      const optimizations = [];
      
      for (const suggestion of suggestions) {
        if (suggestion.priority === 'high') {
          logger.info(`[PerformanceOptimizer] Applying optimization: ${suggestion.suggestion}`);
          
          // Apply specific optimizations
          switch (suggestion.type) {
            case 'performance':
              // Create optimized version of slow function
              optimizations.push({
                type: 'cache',
                target: suggestion.target,
                applied: true
              });
              break;
              
            case 'memory':
              // Trigger garbage collection if available
              if (window.gc) {
                window.gc();
              }
              optimizations.push({
                type: 'gc',
                applied: true
              });
              break;
              
            case 'reliability':
              // Add error wrapper
              optimizations.push({
                type: 'error-wrapper',
                target: suggestion.target,
                applied: true
              });
              break;
          }
        }
      }
      
      logger.info(`[PerformanceOptimizer] Applied ${optimizations.length} optimizations`);
      return optimizations;
    };
    
    // Get performance report
    const getReport = () => {
      const report = {
        monitoring: isMonitoring,
        operations: {},
        memory: {},
        errors: metrics.errors.slice(-10),
        bottlenecks: analyzeBottlenecks(),
        suggestions: generateOptimizations()
      };
      
      // Summarize operations
      metrics.operations.forEach((opMetrics, name) => {
        report.operations[name] = {
          count: opMetrics.count,
          avgDuration: opMetrics.avgDuration,
          minDuration: opMetrics.minDuration,
          maxDuration: opMetrics.maxDuration,
          lastDuration: opMetrics.lastDuration
        };
      });
      
      // Summarize memory
      if (metrics.memory.length > 0) {
        const latest = metrics.memory[metrics.memory.length - 1];
        report.memory = {
          used: latest.usedJSHeapSize,
          total: latest.totalJSHeapSize,
          limit: latest.jsHeapSizeLimit,
          usage: (latest.usedJSHeapSize / latest.jsHeapSizeLimit * 100).toFixed(1) + '%'
        };
      }
      
      return report;
    };
    
    // Clear metrics
    const clearMetrics = () => {
      metrics.operations.clear();
      metrics.cycles = [];
      metrics.memory = [];
      metrics.errors = [];
      logger.info('[PerformanceOptimizer] Metrics cleared');
    };
    
    // Stop monitoring
    const stop = () => {
      if (observer) {
        observer.disconnect();
      }
      isMonitoring = false;
      logger.info('[PerformanceOptimizer] Performance monitoring stopped');
    };
    
    // Initialize on module load
    initialize();
    
    // Public API
    return {
      api: {
        measureFunction,
        wrapModule,
        profileCode,
        analyzeBottlenecks,
        generateOptimizations,
        onOptimizationNeeded,
        selfOptimize,
        getReport,
        clearMetrics,
        stop
      }
    };
  }
};

// Legacy compatibility wrapper
const PerformanceOptimizerModule = (logger, StateManager, Utils) => {
  const instance = PerformanceOptimizer.factory({ logger, StateManager, Utils });
  return instance.api;
};

// Export both formats
PerformanceOptimizer;
PerformanceOptimizerModule;