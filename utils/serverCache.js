/**
 * Server-side cache utility using node-cache
 * Sized for 5,000 student load:
 *   - GPA cached 2 min per student (5k × ~500 bytes = 2.5MB max)
 *   - Dashboard cached 1 min per student
 *   - Schedule/master cached 10 min (shared across all users)
 *   - Staff list / courses cached 5 min
 */
const NodeCache = require('node-cache');

// stdTTL = default TTL in seconds, checkperiod = cleanup interval
const cache = new NodeCache({ stdTTL: 120, checkperiod: 60, useClones: false });

/**
 * Get or compute a cached value.
 * @param {string} key - Cache key
 * @param {Function} fn - Async function to compute value on cache miss
 * @param {number} [ttl] - TTL in seconds (overrides default)
 */
const getOrSet = async (key, fn, ttl) => {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const value = await fn();
  cache.set(key, value, ttl !== undefined ? ttl : undefined);
  return value;
};

/**
 * Invalidate one or more cache keys (supports prefix wildcard).
 * serverCache.del('gpa:') deletes all keys starting with 'gpa:'
 */
const del = (keyOrPrefix) => {
  if (!keyOrPrefix.endsWith(':')) {
    cache.del(keyOrPrefix);
    return;
  }
  // prefix match
  const keys = cache.keys().filter(k => k.startsWith(keyOrPrefix));
  cache.del(keys);
};

/** Flush the entire cache (use after bulk grade imports, semester resets, etc.) */
const flush = () => cache.flushAll();

const TTL = {
  GPA:        120,   // 2 min  — per-student GPA
  DASHBOARD:   60,   // 1 min  — per-student dashboard stats
  SCHEDULE:   600,   // 10 min — master schedule (shared)
  COURSES:    300,   // 5 min  — course list
  STAFF:      300,   // 5 min  — staff list
  STATS:      180,   // 3 min  — grade statistics
};

module.exports = { getOrSet, del, flush, TTL, _cache: cache };

