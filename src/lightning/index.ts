/**
 * Sparkle Protocol - Lightning Module
 *
 * Unified interface for LND and Core Lightning (CLN) nodes.
 *
 * @module sparkle-protocol/lightning
 * @version 0.3.0
 */

export {
  LightningConnector,
  LNDConnector,
  CLNConnector,
  createLightningConnector,
  createSwapInvoice,
  waitForPayment,
  type LightningBackend,
  type LightningConfig,
  type Invoice,
  type Payment,
  type NodeInfo,
  type Channel,
  type CreateInvoiceParams as LightningCreateInvoiceParams,
  type PayInvoiceParams,
} from './lightning-connector.js';
