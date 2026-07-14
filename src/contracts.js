import { CHECK_RESULT_VALUES, OUTCOME_VALUES } from './constants.js';
import { diagnostic } from './errors.js';

const CONFIG_KEYS = new Set([
  '$schema',
  'schemaVersion',
  'projectRoot',
  'requiredFiles',
  'requiredPhrases',
  'skillBudgets',
  'routeBudgets',
  'scenarios',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function add(diagnostics, path, message, code = 'SCHEMA_INVALID') {
  diagnostics.push(diagnostic(code, message, { path }));
}

function checkKeys(value, allowed, objectPath, diagnostics) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      add(diagnostics, `${objectPath}.${key}`, 'Unknown property.');
    }
  }
}

function checkString(value, valuePath, diagnostics) {
  if (typeof value !== 'string' || value.length === 0) {
    add(diagnostics, valuePath, 'Expected a non-empty string.');
    return false;
  }
  return true;
}

function checkPositiveInteger(value, valuePath, diagnostics) {
  if (!Number.isInteger(value) || value < 1) {
    add(diagnostics, valuePath, 'Expected a positive integer.');
    return false;
  }
  return true;
}

function checkStringArray(value, valuePath, diagnostics, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    add(diagnostics, valuePath, allowEmpty ? 'Expected an array.' : 'Expected a non-empty array.');
    return false;
  }

  const seen = new Set();
  value.forEach((item, index) => {
    if (checkString(item, `${valuePath}[${index}]`, diagnostics)) {
      if (seen.has(item)) {
        add(diagnostics, `${valuePath}[${index}]`, 'Duplicate value.');
      }
      seen.add(item);
    }
  });
  return true;
}

export function validateConfigObject(input) {
  const diagnostics = [];
  if (!isObject(input)) {
    add(diagnostics, '$', 'Expected a JSON object.');
    return { valid: false, diagnostics };
  }

  checkKeys(input, CONFIG_KEYS, '$', diagnostics);
  if (input.$schema !== undefined && typeof input.$schema !== 'string') {
    add(diagnostics, '$.$schema', 'Expected a string.');
  }
  if (input.schemaVersion !== 1) {
    add(diagnostics, '$.schemaVersion', 'Expected schemaVersion 1.');
  }
  checkString(input.projectRoot, '$.projectRoot', diagnostics);

  const requiredFiles = input.requiredFiles ?? [];
  checkStringArray(requiredFiles, '$.requiredFiles', diagnostics);

  const requiredPhrases = input.requiredPhrases ?? [];
  if (!Array.isArray(requiredPhrases)) {
    add(diagnostics, '$.requiredPhrases', 'Expected an array.');
  } else {
    requiredPhrases.forEach((rule, index) => {
      const rulePath = `$.requiredPhrases[${index}]`;
      if (!isObject(rule)) {
        add(diagnostics, rulePath, 'Expected an object.');
        return;
      }
      checkKeys(rule, new Set(['file', 'phrases']), rulePath, diagnostics);
      checkString(rule.file, `${rulePath}.file`, diagnostics);
      checkStringArray(rule.phrases, `${rulePath}.phrases`, diagnostics, { allowEmpty: false });
    });
  }

  const skillBudgets = input.skillBudgets;
  if (skillBudgets !== undefined) {
    if (!isObject(skillBudgets)) {
      add(diagnostics, '$.skillBudgets', 'Expected an object.');
    } else {
      checkKeys(skillBudgets, new Set(['defaultMaxWords', 'files', 'overrides']), '$.skillBudgets', diagnostics);
      checkPositiveInteger(skillBudgets.defaultMaxWords, '$.skillBudgets.defaultMaxWords', diagnostics);
      checkStringArray(skillBudgets.files, '$.skillBudgets.files', diagnostics, { allowEmpty: false });
      if (!isObject(skillBudgets.overrides)) {
        add(diagnostics, '$.skillBudgets.overrides', 'Expected an object.');
      } else {
        for (const [file, budget] of Object.entries(skillBudgets.overrides)) {
          checkString(file, '$.skillBudgets.overrides', diagnostics);
          checkPositiveInteger(budget, `$.skillBudgets.overrides.${file}`, diagnostics);
          if (Array.isArray(skillBudgets.files) && !skillBudgets.files.includes(file)) {
            add(diagnostics, `$.skillBudgets.overrides.${file}`, 'Override must reference a listed skill file.');
          }
        }
      }
    }
  }

  const routeBudgets = input.routeBudgets ?? [];
  const routeNames = new Set();
  if (!Array.isArray(routeBudgets)) {
    add(diagnostics, '$.routeBudgets', 'Expected an array.');
  } else {
    routeBudgets.forEach((route, index) => {
      const routePath = `$.routeBudgets[${index}]`;
      if (!isObject(route)) {
        add(diagnostics, routePath, 'Expected an object.');
        return;
      }
      checkKeys(route, new Set(['name', 'maxWords', 'warningPercent', 'files']), routePath, diagnostics);
      if (checkString(route.name, `${routePath}.name`, diagnostics)) {
        if (routeNames.has(route.name)) add(diagnostics, `${routePath}.name`, 'Route name must be unique.');
        routeNames.add(route.name);
      }
      checkPositiveInteger(route.maxWords, `${routePath}.maxWords`, diagnostics);
      if (route.warningPercent !== undefined) {
        checkPositiveInteger(route.warningPercent, `${routePath}.warningPercent`, diagnostics);
        if (Number.isInteger(route.warningPercent) && route.warningPercent > 100) {
          add(diagnostics, `${routePath}.warningPercent`, 'Expected an integer from 1 to 100.');
        }
      }
      checkStringArray(route.files, `${routePath}.files`, diagnostics, { allowEmpty: false });
    });
  }

  const scenarios = input.scenarios ?? [];
  const scenarioNames = new Set();
  if (!Array.isArray(scenarios)) {
    add(diagnostics, '$.scenarios', 'Expected an array.');
  } else {
    scenarios.forEach((scenario, index) => {
      const scenarioPath = `$.scenarios[${index}]`;
      if (!isObject(scenario)) {
        add(diagnostics, scenarioPath, 'Expected an object.');
        return;
      }
      checkKeys(scenario, new Set(['name', 'file', 'requiredPhrases']), scenarioPath, diagnostics);
      if (checkString(scenario.name, `${scenarioPath}.name`, diagnostics)) {
        if (scenarioNames.has(scenario.name)) add(diagnostics, `${scenarioPath}.name`, 'Scenario name must be unique.');
        scenarioNames.add(scenario.name);
      }
      checkString(scenario.file, `${scenarioPath}.file`, diagnostics);
      checkStringArray(scenario.requiredPhrases, `${scenarioPath}.requiredPhrases`, diagnostics, { allowEmpty: false });
    });
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
    value: diagnostics.length === 0
      ? {
          ...input,
          requiredFiles,
          requiredPhrases,
          routeBudgets,
          scenarios,
        }
      : undefined,
  };
}

const RUN_KEYS = new Set(['$schema', 'schemaVersion', 'runId', 'scenario', 'result', 'startedAt', 'durationMs', 'checks', 'metrics', 'tags']);
const CHECK_KEYS = new Set(['name', 'result', 'message']);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export function validateRunRecordObject(input) {
  const diagnostics = [];
  if (!isObject(input)) {
    add(diagnostics, '$', 'Expected a JSON object.');
    return { valid: false, diagnostics };
  }

  checkKeys(input, RUN_KEYS, '$', diagnostics);
  if (input.$schema !== undefined && typeof input.$schema !== 'string') add(diagnostics, '$.$schema', 'Expected a string.');
  if (input.schemaVersion !== 1) add(diagnostics, '$.schemaVersion', 'Expected schemaVersion 1.');
  if (!checkString(input.runId, '$.runId', diagnostics) || !SAFE_ID.test(input.runId)) {
    if (typeof input.runId === 'string' && input.runId.length > 0) add(diagnostics, '$.runId', 'Use 1-128 letters, numbers, dots, underscores, or hyphens.');
  }
  checkString(input.scenario, '$.scenario', diagnostics);
  if (!OUTCOME_VALUES.includes(input.result)) add(diagnostics, '$.result', 'Expected succeeded, no-op, blocked, failed, or escalated.');
  if (typeof input.startedAt !== 'string' || !ISO_TIMESTAMP.test(input.startedAt) || Number.isNaN(Date.parse(input.startedAt))) {
    add(diagnostics, '$.startedAt', 'Expected an ISO 8601 UTC timestamp with milliseconds.');
  }
  if (!Number.isInteger(input.durationMs) || input.durationMs < 0) add(diagnostics, '$.durationMs', 'Expected a non-negative integer.');

  if (!Array.isArray(input.checks)) {
    add(diagnostics, '$.checks', 'Expected an array.');
  } else {
    input.checks.forEach((check, index) => {
      const checkPath = `$.checks[${index}]`;
      if (!isObject(check)) {
        add(diagnostics, checkPath, 'Expected an object.');
        return;
      }
      checkKeys(check, CHECK_KEYS, checkPath, diagnostics);
      checkString(check.name, `${checkPath}.name`, diagnostics);
      if (!CHECK_RESULT_VALUES.includes(check.result)) add(diagnostics, `${checkPath}.result`, 'Expected pass, fail, or error.');
      if (check.message !== undefined && (typeof check.message !== 'string' || check.message.length > 500)) {
        add(diagnostics, `${checkPath}.message`, 'Expected a string no longer than 500 characters.');
      }
    });
  }

  if (!isObject(input.metrics)) {
    add(diagnostics, '$.metrics', 'Expected an object of finite numbers.');
  } else {
    for (const [name, value] of Object.entries(input.metrics)) {
      if (!SAFE_ID.test(name)) add(diagnostics, `$.metrics.${name}`, 'Metric name is not portable.');
      if (typeof value !== 'number' || !Number.isFinite(value)) add(diagnostics, `$.metrics.${name}`, 'Expected a finite number.');
    }
  }

  if (input.tags !== undefined) checkStringArray(input.tags, '$.tags', diagnostics);
  return { valid: diagnostics.length === 0, diagnostics, value: diagnostics.length === 0 ? input : undefined };
}
