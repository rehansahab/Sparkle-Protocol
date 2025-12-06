/**
 * Sparkle Protocol - Coordinator Module
 *
 * Non-custodial trade coordination with WebSocket real-time updates.
 *
 * @module sparkle-protocol/coordinator
 * @version 0.3.0
 */

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
