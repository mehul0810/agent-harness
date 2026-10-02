// Model-free descriptor validation. It confers no model, execution or adoption authority.
const invariants = ['independent_model_and_effort', 'explicit_locks', 'verified_runtime_support', 'authorized_set_and_budget', 'feasibility_before_capacity', 'cause_aware_bounded_retry', 'proportional_context_and_delegation', 'no_authority_expansion'];
export function validateRoutingContract(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['routing descriptor must be an object'] };
  const keys = ['schema_version', 'policy_version', 'canonical_repository', 'canonical_path', 'mode', 'invariants'];
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) errors.push('routing descriptor must use the closed schema');
  if (value.schema_version !== '1.0') errors.push('unsupported routing descriptor schema');
  if (typeof value.policy_version !== 'string' || !/^[a-z0-9][a-z0-9.-]{2,63}$/u.test(value.policy_version)) errors.push('invalid policy version');
  if (typeof value.canonical_repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.canonical_repository)) errors.push('invalid canonical repository');
  if (typeof value.canonical_path !== 'string' || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(value.canonical_path) || value.canonical_path.split('/').some(part => part === '.' || part === '..')) errors.push('invalid canonical policy path');
  if (!['proposal','adopted'].includes(value.mode)) errors.push('invalid adoption mode');
  if (!Array.isArray(value.invariants) || value.invariants.length !== invariants.length || new Set(value.invariants).size !== invariants.length || invariants.some(rule => !value.invariants.includes(rule))) errors.push('routing descriptor must preserve every boundary invariant');
  return { ok: errors.length === 0, errors };
}
