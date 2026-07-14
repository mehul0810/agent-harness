export const VERSION = '0.1.0';

export const EXIT_CODES = Object.freeze({
  OK: 0,
  VALIDATION_FAILED: 1,
  INVALID_INPUT: 2,
  UNSAFE_PATH: 3,
  INIT_CONFLICT: 4,
  INTERNAL_ERROR: 70,
});

export const OUTCOME_VALUES = Object.freeze(['succeeded', 'no-op', 'blocked', 'failed', 'escalated']);
export const CHECK_RESULT_VALUES = Object.freeze(['pass', 'fail', 'error']);
