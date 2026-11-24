/**
 * Advisory lock every writer that assigns `change_seq` versions must hold (transaction-level), so versions
 * commit in order and a pull's cursor never jumps over a version that commits later.
 */
export const CHANGE_LOCK = 1;
