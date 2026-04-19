/**
 * @deprecated Import from `payment-instruction.service.js` for new code.
 * Re-export keeps legacy import path working.
 */

export {
  buildPaymentInstructionForSellTransaction as buildOfframpCalldataForTransaction,
  type PaymentInstruction as OfframpCalldataPayload,
} from "./payment-instruction.service.js";
