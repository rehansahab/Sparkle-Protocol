/**
 * Sparkle Protocol - Coordinator Module
 *
 * Non-custodial trade coordination with WebSocket real-time updates,
 * REST API, and persistent storage.
 *
 * @module sparkle-protocol/coordinator
 * @version 1.0.0
 */

// WebSocket Coordinator
export {
  CoordinatorServer,
  createCoordinator,
  DEFAULT_COORDINATOR_CONFIG,
  type Swap,
  type SwapStatus,
  type SwapParticipant,
  type SwapMessage,
  type WebSocketClient,
  type CoordinatorConfig,
  type CreateSwapParams,
  type AcceptSwapParams,
  type WSMessage,
  type WSMessageType,
  type WSResponse,
} from './coordinator-server.js';

// HTTP REST API
export {
  CoordinatorHttpServer,
  createCoordinatorHttpServer,
  type SwapListItem,
  type CreateSwapRequest,
  type ApiResponse,
  type HealthStatus,
  type CoordinatorHttpServerConfig,
} from './http-server.js';

// Database Layer
export {
  CoordinatorDatabase,
  createDatabase,
  generateSwapId,
  generateMessageId,
  type SwapRecord,
  type SwapMessage as DbSwapMessage,
  type DatabaseStats,
} from './database.js';
