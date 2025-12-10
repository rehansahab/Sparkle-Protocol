/**
 * Sparkle Protocol - Production Module
 *
 * DEPRECATED: This module now re-exports from the new flat structure.
 * Import directly from 'sparkle-protocol' instead.
 *
 * @module sparkle-protocol/production
 * @version 1.0.0-rc.1
 * @deprecated Use direct imports from 'sparkle-protocol'
 */

// Re-export everything from the new flat structure for backwards compatibility
export * from '../sdk-constants.js';
export * from '../sdk-types.js';
export * from '../sdk-providers.js';
export * from '../sdk-safety.js';
export * from '../sdk-psbt.js';
export * from '../sdk-ghost-desk.js';
export * from '../adapters/index.js';

// Re-export SDK class
import { SparkleSDK, createSparkleSDK } from '../index.js';
export { SparkleSDK, createSparkleSDK };
