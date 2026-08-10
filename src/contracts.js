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
  'behaviorBaselines',
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

function checkNonNegativeNumber(value, valuePath, diagnostics) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    add(diagnostics, valuePath, 'Expected a non-negative finite number.');
    return false;
  }
  return true;
}

function checkSha256(value, valuePath, diagnostics) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    add(diagnostics, valuePath, 'Expected a lowercase SHA-256 digest.');
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

  const behaviorBaselines = input.behaviorBaselines ?? [];
  const baselineNames = new Set();
  if (!Array.isArray(behaviorBaselines)) {
    add(diagnostics, '$.behaviorBaselines', 'Expected an array.');
  } else {
    behaviorBaselines.forEach((baseline, index) => {
      const baselinePath = `$.behaviorBaselines[${index}]`;
      if (!isObject(baseline)) {
        add(diagnostics, baselinePath, 'Expected an object.');
        return;
      }
      checkKeys(baseline, new Set([
        'name', 'sourceFiles', 'sourceSha256', 'scenario', 'requiredChecks', 'requiredTags',
        'maxAgeDays', 'telemetryBudgets', 'evidence',
      ]), baselinePath, diagnostics);
      if (checkString(baseline.name, `${baselinePath}.name`, diagnostics)) {
        if (baselineNames.has(baseline.name)) add(diagnostics, `${baselinePath}.name`, 'Behavior baseline name must be unique.');
        baselineNames.add(baseline.name);
      }
      checkStringArray(baseline.sourceFiles, `${baselinePath}.sourceFiles`, diagnostics, { allowEmpty: false });
      checkSha256(baseline.sourceSha256, `${baselinePath}.sourceSha256`, diagnostics);
      checkStringArray(baseline.requiredChecks, `${baselinePath}.requiredChecks`, diagnostics, { allowEmpty: false });
      if (baseline.requiredTags !== undefined) checkStringArray(baseline.requiredTags, `${baselinePath}.requiredTags`, diagnostics, { allowEmpty: false });
      if (baseline.maxAgeDays !== undefined) {
        checkPositiveInteger(baseline.maxAgeDays, `${baselinePath}.maxAgeDays`, diagnostics);
        if (Number.isInteger(baseline.maxAgeDays) && baseline.maxAgeDays > 365) add(diagnostics, `${baselinePath}.maxAgeDays`, 'Expected at most 365 days.');
      }

      const scenario = baseline.scenario;
      if (!isObject(scenario)) {
        add(diagnostics, `${baselinePath}.scenario`, 'Expected an object.');
      } else {
        checkKeys(scenario, new Set(['id', 'files', 'anchors', 'sha256']), `${baselinePath}.scenario`, diagnostics);
        checkString(scenario.id, `${baselinePath}.scenario.id`, diagnostics);
        checkStringArray(scenario.files, `${baselinePath}.scenario.files`, diagnostics, { allowEmpty: false });
        checkStringArray(scenario.anchors, `${baselinePath}.scenario.anchors`, diagnostics, { allowEmpty: false });
        checkSha256(scenario.sha256, `${baselinePath}.scenario.sha256`, diagnostics);
      }

      const evidence = baseline.evidence;
      if (!isObject(evidence)) {
        add(diagnostics, `${baselinePath}.evidence`, 'Expected an object.');
      } else {
        checkKeys(evidence, new Set(['runRecord', 'runRecordSha256', 'testedSourceSha256', 'testedScenarioSha256']), `${baselinePath}.evidence`, diagnostics);
        checkString(evidence.runRecord, `${baselinePath}.evidence.runRecord`, diagnostics);
        checkSha256(evidence.runRecordSha256, `${baselinePath}.evidence.runRecordSha256`, diagnostics);
        checkSha256(evidence.testedSourceSha256, `${baselinePath}.evidence.testedSourceSha256`, diagnostics);
        checkSha256(evidence.testedScenarioSha256, `${baselinePath}.evidence.testedScenarioSha256`, diagnostics);
      }

      const telemetryBudgets = baseline.telemetryBudgets ?? [];
      if (!Array.isArray(telemetryBudgets)) {
        add(diagnostics, `${baselinePath}.telemetryBudgets`, 'Expected an array.');
      } else {
        const metrics = new Set();
        telemetryBudgets.forEach((budget, budgetIndex) => {
          const budgetPath = `${baselinePath}.telemetryBudgets[${budgetIndex}]`;
          if (!isObject(budget)) {
            add(diagnostics, budgetPath, 'Expected an object.');
            return;
          }
          checkKeys(budget, new Set(['metric', 'required', 'max', 'baseline', 'maxRegressionPercent']), budgetPath, diagnostics);
          if (checkString(budget.metric, `${budgetPath}.metric`, diagnostics)) {
            if (!SAFE_ID.test(budget.metric)) add(diagnostics, `${budgetPath}.metric`, 'Metric name is not portable.');
            if (metrics.has(budget.metric)) add(diagnostics, `${budgetPath}.metric`, 'Telemetry metric must be unique in a baseline.');
            metrics.add(budget.metric);
          }
          if (budget.required !== undefined && typeof budget.required !== 'boolean') add(diagnostics, `${budgetPath}.required`, 'Expected a boolean.');
          if (budget.max !== undefined) checkNonNegativeNumber(budget.max, `${budgetPath}.max`, diagnostics);
          if (budget.baseline !== undefined) checkNonNegativeNumber(budget.baseline, `${budgetPath}.baseline`, diagnostics);
          if (budget.maxRegressionPercent !== undefined) checkNonNegativeNumber(budget.maxRegressionPercent, `${budgetPath}.maxRegressionPercent`, diagnostics);
          const hasMaximum = budget.max !== undefined;
          const hasRegression = budget.baseline !== undefined && budget.maxRegressionPercent !== undefined;
          if (!hasMaximum && !hasRegression) add(diagnostics, budgetPath, 'Expected max or baseline plus maxRegressionPercent.');
          if ((budget.baseline === undefined) !== (budget.maxRegressionPercent === undefined)) add(diagnostics, budgetPath, 'baseline and maxRegressionPercent must be provided together.');
        });
      }
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
          behaviorBaselines,
        }
      : undefined,
  };
}

const RUN_KEYS = new Set(['$schema', 'schemaVersion', 'runId', 'scenario', 'result', 'startedAt', 'durationMs', 'checks', 'metrics', 'tags', 'lineage', 'measurement']);
const CHECK_KEYS = new Set(['name', 'result', 'message']);
const LINEAGE_KEYS = new Set(['observationId', 'workItemId', 'decisionId', 'actionId', 'verificationId', 'learningCandidateId', 'artifactPointer']);
const MEASUREMENT_KEYS = new Set(['status', 'windowEndsAt', 'verifiedAt', 'metricNames', 'summary']);
const MEASUREMENT_STATES = new Set(['pending', 'met', 'missed', 'inconclusive', 'not_applicable']);
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
    const checkNames = new Set();
    input.checks.forEach((check, index) => {
      const checkPath = `$.checks[${index}]`;
      if (!isObject(check)) {
        add(diagnostics, checkPath, 'Expected an object.');
        return;
      }
      checkKeys(check, CHECK_KEYS, checkPath, diagnostics);
      if (checkString(check.name, `${checkPath}.name`, diagnostics)) {
        if (checkNames.has(check.name)) add(diagnostics, `${checkPath}.name`, 'Check name must be unique.');
        checkNames.add(check.name);
      }
      if (!CHECK_RESULT_VALUES.includes(check.result)) add(diagnostics, `${checkPath}.result`, 'Expected pass, fail, or error.');
      if (check.message !== undefined && (typeof check.message !== 'string' || check.message.length > 500)) {
        add(diagnostics, `${checkPath}.message`, 'Expected a string no longer than 500 characters.');
      }
    });
    if (input.result === 'succeeded' && input.checks.length === 0) add(diagnostics, '$.checks', 'A succeeded run requires at least one check.');
    if (input.result === 'succeeded' && input.checks.some((check) => check?.result !== 'pass')) add(diagnostics, '$.checks', 'Every check in a succeeded run must pass.');
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

  if (input.lineage !== undefined) {
    if (!isObject(input.lineage) || Object.keys(input.lineage).length === 0) {
      add(diagnostics, '$.lineage', 'Expected a non-empty object.');
    } else {
      checkKeys(input.lineage, LINEAGE_KEYS, '$.lineage', diagnostics);
      for (const [name, value] of Object.entries(input.lineage)) {
        if (checkString(value, `$.lineage.${name}`, diagnostics) && value.length > 500) {
          add(diagnostics, `$.lineage.${name}`, 'Expected a string no longer than 500 characters.');
        }
      }
    }
  }

  if (input.measurement !== undefined) {
    if (!isObject(input.measurement)) {
      add(diagnostics, '$.measurement', 'Expected an object.');
    } else {
      checkKeys(input.measurement, MEASUREMENT_KEYS, '$.measurement', diagnostics);
      if (!MEASUREMENT_STATES.has(input.measurement.status)) add(diagnostics, '$.measurement.status', 'Expected pending, met, missed, inconclusive, or not_applicable.');
      for (const name of ['windowEndsAt', 'verifiedAt']) {
        const value = input.measurement[name];
        if (value !== undefined && value !== null && (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value)))) {
          add(diagnostics, `$.measurement.${name}`, 'Expected null or an ISO 8601 UTC timestamp with milliseconds.');
        }
      }
      if (input.measurement.metricNames !== undefined) {
        checkStringArray(input.measurement.metricNames, '$.measurement.metricNames', diagnostics);
        for (const [index, name] of input.measurement.metricNames.entries()) {
          if (!SAFE_ID.test(name)) add(diagnostics, `$.measurement.metricNames[${index}]`, 'Metric name is not portable.');
        }
      }
      if (input.measurement.summary !== undefined && (typeof input.measurement.summary !== 'string' || input.measurement.summary.length > 500)) {
        add(diagnostics, '$.measurement.summary', 'Expected a string no longer than 500 characters.');
      }
      const { status, windowEndsAt, verifiedAt, summary } = input.measurement;
      if (status === 'pending' && (typeof windowEndsAt !== 'string' || Number.isNaN(Date.parse(windowEndsAt)))) {
        add(diagnostics, '$.measurement.windowEndsAt', 'A pending measurement requires a verification window end.');
      }
      if (['met', 'missed', 'inconclusive'].includes(status)) {
        if (typeof verifiedAt !== 'string' || Number.isNaN(Date.parse(verifiedAt))) add(diagnostics, '$.measurement.verifiedAt', 'A closed measurement requires a verification timestamp.');
        if (typeof summary !== 'string' || summary.trim() === '') add(diagnostics, '$.measurement.summary', 'A closed measurement requires a concise evidence summary.');
      }
      if (status === 'not_applicable' && (typeof summary !== 'string' || summary.trim() === '')) add(diagnostics, '$.measurement.summary', 'A not-applicable measurement requires a reason.');
      if (typeof verifiedAt === 'string' && typeof input.startedAt === 'string' && !Number.isNaN(Date.parse(verifiedAt)) && !Number.isNaN(Date.parse(input.startedAt)) && Date.parse(verifiedAt) < Date.parse(input.startedAt)) {
        add(diagnostics, '$.measurement.verifiedAt', 'Verification cannot precede the run start.');
      }
    }
  }
  return { valid: diagnostics.length === 0, diagnostics, value: diagnostics.length === 0 ? input : undefined };
}
