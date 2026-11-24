const {createEvaluator} = require('./idyll_safe_expression.cjs');
const formatNumber = require('d3-format').format;

const TASKS = new Set(['idyll-explorer-v2', 'idyll-story-v2']);
const CATEGORIES = ['Books', 'Games', 'Music'];
const STAGES = ['Overview', 'Focus', 'Average', 'Threshold'];
const kind = node => String(node.name || '').toLowerCase().replace(/-/g, '');
const rowKey = row => `${row.month}\u0000${row.category}\u0000${row.sales}`;
const sameRows = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && actual.every(row => row && typeof row.month === 'string' && typeof row.category === 'string' && Number.isFinite(row.sales)) && actual.map(rowKey).sort().join('\n') === expected.map(rowKey).sort().join('\n');
const empty = value => value === undefined || Array.isArray(value) && value.length === 0;
const test = (id, label, passed, message) => ({id, label, passed: Boolean(passed), message: passed ? 'Requirement satisfied.' : message});

function check(ast, taskId, data) {
  if (!TASKS.has(taskId)) throw Error('Unknown advanced Idyll task.');
  if (!Array.isArray(data) || !data.length || data.length > 100) throw Error('The fixed sales dataset is unavailable.');
  const definitions = new Map();
  const mutable = new Set();
  const nodes = [];
  let count = 0;
  const collect = (node, ancestors = [], depth = 0) => {
    if (++count > 3000 || depth > 60 || !node || typeof node !== 'object') throw Error('Program structure exceeds the supported limit.');
    for (const name of Object.keys(node.properties || {})) {
      if (['style', 'class', 'classname', 'hidden', 'inert', 'aria-hidden', 'dangerouslysetinnerhtml'].includes(name.toLowerCase()) || /^on/i.test(name)) throw Error('Use unstyled built-in components without event handlers or hidden outputs.');
    }
    if (['var', 'derived', 'data'].includes(node.type)) {
      const name = node.properties?.name?.value;
      if (typeof name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(name) || ['__proto__', 'prototype', 'constructor', 'Math', 'undefined', 'NaN', 'Infinity'].includes(name) || definitions.has(name)) throw Error('Use unique, ordinary variable and dataset names.');
      if (node.type === 'data' && (name !== 'sales' || node.properties?.source?.type !== 'value' || node.properties.source.value !== 'sales-data.json')) throw Error('Use the supplied sales dataset: [data name:"sales" source:"sales-data.json" /].');
      definitions.set(name, node);
      if (node.type === 'var') mutable.add(name);
    }
    if (node.type === 'component') nodes.push({node, ancestors});
    if (node.children && !Array.isArray(node.children)) throw Error('Invalid program children.');
    for (const child of node.children || []) collect(child, [...ancestors, node], depth + 1);
  };
  collect(ast);
  if (definitions.get('sales')?.type !== 'data') throw Error('Declare the fixed sales dataset with a data declaration.');

  const state = overrides => {
    const cache = new Map();
    const active = new Set();
    let accessed = new Set();
    let evaluateExpression;
    const resolve = name => {
      accessed.add(name);
      const declaration = definitions.get(name);
      if (!declaration) throw Error(`Unknown variable: ${name}`);
      const owner = active.size ? definitions.get(active.values().next().value) : null;
      if (owner && ((owner.type === 'var' && declaration.type === 'derived') || (!cache.has(name) && !Object.hasOwn(overrides, name) && declaration.type !== 'data'))) throw Error('Declare dependencies before derived expressions; initialize variables before using them and do not initialize a variable from a derived value.');
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (cache.has(name)) {
        const result = cache.get(name);
        result.accessed.forEach(item => accessed.add(item));
        return result.value;
      }
      if (active.has(name)) throw Error('Circular variable definitions.');
      active.add(name);
      const prior = accessed;
      accessed = new Set([name]);
      const value = declaration.type === 'data' ? data : property(declaration.properties?.value);
      const dependencies = accessed;
      accessed = prior;
      dependencies.forEach(item => accessed.add(item));
      cache.set(name, {value, accessed: dependencies});
      active.delete(name);
      return value;
    };
    evaluateExpression = createEvaluator(resolve);
    const property = item => {
      if (!item) return undefined;
      if (item.type === 'value') return item.value;
      if (item.type === 'variable') return resolve(item.value);
      if (item.type === 'expression') return evaluateExpression(item.value);
      throw Error('Unsupported component property.');
    };
    const read = item => {
      accessed = new Set();
      const value = property(item);
      return {value, accessed: new Set(accessed)};
    };
    for (const name of definitions.keys()) resolve(name);
    const evaluated = new Map();
    const validRows = (value, reference = false) => Array.isArray(value) && value.length <= 500 && value.every(row => row && typeof row === 'object' && typeof row.month === 'string' && Number.isFinite(Date.parse(row.month)) && Number.isFinite(row.sales) && (reference || typeof row.category === 'string'));
    for (const {node} of nodes) {
      const name = kind(node);
      const props = Object.create(null);
      const dependencies = Object.create(null);
      for (const [key, value] of Object.entries(node.properties || {})) {
        const result = read(value);
        props[key] = result.value;
        dependencies[key] = result.accessed;
      }
      if (name === 'table' || name === 'chart') {
        if (!validRows(props.data === undefined ? [] : props.data) || props.label !== undefined && typeof props.label !== 'string') throw Error('Table/Chart require valid sales records and a text label.');
      }
      if (name === 'chart') {
        if (!['point', 'line'].includes(props.type || 'point') || ![undefined, 'month'].includes(props.x) || ![undefined, 'sales'].includes(props.y) || ![undefined, 'category'].includes(props.color) || props.focus !== undefined && typeof props.focus !== 'string' || !validRows(props.reference === undefined ? [] : props.reference, true) || !validRows(props.highlight === undefined ? [] : props.highlight)) throw Error('Chart properties do not match the supported rendering contract.');
      }
      if (name === 'display') {
        const value = props.value === undefined ? props.var : props.value;
        if (value !== null && typeof value === 'object') throw Error('Checked Display values must be scalars.');
        if (props.format !== undefined && (node.properties.format.type !== 'value' || typeof props.format !== 'string' || props.format.length > 32 || (props.format.match(/\d+/g) || []).some(number => Number(number) > 100))) throw Error('Use a fixed, bounded numeric display format.');
        formatNumber(props.format || '0.2f');
      }
      if (name === 'select' || name === 'range') {
        const allowed = new Set(['value', 'disabled', 'name', 'id', 'aria-label', 'title', ...(name === 'select' ? ['options'] : ['min', 'max', 'step'])]);
        if (Object.keys(props).some(key => !allowed.has(key)) || props.disabled !== undefined && typeof props.disabled !== 'boolean') throw Error('Use only documented properties on a single-value Select or Range control.');
        if (name === 'range' && ['value', 'min', 'max', 'step'].some(key => props[key] !== undefined && (typeof props[key] !== 'number' || !Number.isFinite(props[key])))) throw Error('Range values and bounds must be finite numbers.');
      }
      if (name === 'select') {
        if (!Array.isArray(props.options) || props.options.length > 100 || props.options.some(option => typeof option !== 'string' && (!option || typeof option.value !== 'string' || option.label !== undefined && typeof option.label !== 'string'))) throw Error('Select options must be strings or objects with string value and label.');
      }
      if (name === 'step' && (!Number.isInteger(props.index) || props.index < 0 || props.index > 20)) throw Error('Step index must be an integer from 0 to 20.');
      evaluated.set(node, {props, dependencies});
    }
    const visible = [];
    let text = '';
    const render = (node, ancestors = []) => {
      if (node.type === 'textnode') { text += `${node.value} `; return; }
      if (node.type !== 'component') return;
      const name = kind(node);
      if (name === 'conditional' && !property(node.properties?.if)) return;
      const {props, dependencies} = evaluated.get(node);
      visible.push({node, ancestors, name, props, dependencies});
      if (name === 'display') {
        const value = props.value === undefined ? props.var : props.value;
        const rendered = typeof value === 'number' ? formatNumber(props.format || '0.2f')(value) : String(value);
        text += `${rendered} `;
        visible[visible.length - 1].rendered = rendered;
      }
      if (name === 'switch') {
        const chosen = (node.children || []).find(child => kind(child) === 'case' && property(child.properties?.test) === props.value) || (node.children || []).find(child => kind(child) === 'default');
        if (chosen) render(chosen, [...ancestors, node]);
        return;
      }
      for (const child of node.children || []) render(child, [...ancestors, node]);
    };
    render(ast);
    return {visible, text, read};
  };

  const defaults = state({});
  const controls = defaults.visible.filter(item => item.name === 'select' || item.name === 'range');
  const select = controls.filter(item => item.name === 'select');
  const range = controls.filter(item => item.name === 'range');
  const binding = item => item?.node.properties?.value?.type === 'variable' && mutable.has(item.node.properties.value.value) ? item.node.properties.value.value : null;
  const optionValues = item => Array.isArray(item.props.options) ? item.props.options.map(option => typeof option === 'string' ? option : option?.value) : [];
  const explorer = taskId === 'idyll-explorer-v2';
  const expectedOptions = explorer ? ['All', ...CATEGORIES] : CATEGORIES;
  const exactOptions = select.length === 1 && JSON.stringify(optionValues(select[0])) === JSON.stringify(expectedOptions);
  const categoryVar = binding(select[0]);
  const thresholdVar = binding(range[0]);
  const enabled = item => item && !item.props.disabled;
  const controlOK = controls.length === 2 && exactOptions && categoryVar && thresholdVar && categoryVar !== thresholdVar && enabled(select[0]) && enabled(range[0]) && range[0].props.min === 0 && range[0].props.max === 500 && range[0].props.step === 10 && select[0].props.value === (explorer ? 'All' : 'Books') && range[0].props.value === (explorer ? 0 : 150);
  const tests = [test('controls', 'Bound category and sales-threshold controls', controlOK, `Use one enabled Select (${expectedOptions.join(', ')}) and one Range from 0 to 500 with step 10, bound to distinct variables with the requested initial values.`)];
  const staticCharts = nodes.filter(item => kind(item.node) === 'chart');
  const staticTables = nodes.filter(item => kind(item.node) === 'table');
  const staticScrollers = nodes.filter(item => kind(item.node) === 'scroller');
  const staticPinned = nodes.filter(item => kind(item.node) === 'pinned');
  const chart = defaults.visible.find(item => item.name === 'chart');
  const chartShape = staticCharts.length === 1 && chart && chart.props.type === (explorer ? 'point' : 'line') && chart.props.x === 'month' && chart.props.y === 'sales' && chart.props.color === 'category';
  if (explorer) {
    tests.push(test('views', 'Linked table and point chart', staticTables.length === 1 && chartShape, 'Use exactly one Table and one Chart with type:"point", x:"month", y:"sales", color:"category".'));
  } else {
    const scroller = staticScrollers[0];
    const pinned = staticPinned[0];
    const stageProp = scroller?.node.properties?.step;
    const stageVar = stageProp?.type === 'variable' && mutable.has(stageProp.value) ? stageProp.value : null;
    const steps = nodes.filter(item => kind(item.node) === 'step');
    const declaredStepIndexes = steps.map(item => item.node.properties?.index?.value);
    const directChildren = scroller?.node.children || [];
    const directStoryChildren = directChildren.filter(node => node.type === 'component' && ['step', 'pinned'].includes(kind(node)));
    const stepText = node => node.type === 'textnode' ? String(node.value || '') : (node.children || []).map(stepText).join(' ');
    const topologyOK = staticScrollers.length === 1 && staticPinned.length === 1 && stageVar && stageVar !== categoryVar && stageVar !== thresholdVar && defaults.read({type:'variable',value:stageVar}).value === 0 && pinned.ancestors.at(-1) === scroller.node && directStoryChildren.length === 5 && steps.length === 4 && JSON.stringify(declaredStepIndexes) === '[0,1,2,3]' && steps.every(item => item.ancestors.at(-1) === scroller.node && !item.ancestors.includes(pinned.node) && stepText(item.node).trim().length >= 20) && chartShape && chart.ancestors.includes(pinned.node) && controls.every(item => item.ancestors.includes(pinned.node));
    tests.push(test('story-layout', 'Four scroll steps with a pinned interactive chart', topologyOK, 'Bind one Scroller step to a variable initially 0; include four Step sections indexed 0–3 and one Pinned region containing the controls and line Chart.'));
    if (!topologyOK || !controlOK) return tests;
    const months = [...new Set(data.map(row => row.month))].sort();
    const averages = months.map(month => ({month, sales: data.filter(row => row.month === month).reduce((total,row) => total + row.sales, 0) / data.filter(row => row.month === month).length}));
    let stageValid = true;
    let resultValid = true;
    let detail = 'Each stage must map to the required chart data, focus, monthly reference averages, and strict-threshold highlights.';
    const thresholds = [...new Set([0,150,500,...data.flatMap(row => [row.sales - 1,row.sales,row.sales + 1])])].filter(value => value >= 0 && value <= 500);
    const stages = [0,1,2,3,2,1,0];
    try {
      for (const category of CATEGORIES) for (const threshold of thresholds) for (const stage of stages) {
        const shown = state({[categoryVar]:category,[thresholdVar]:threshold,[stageVar]:stage});
        const charts = shown.visible.filter(item => item.name === 'chart');
        const display = shown.visible.filter(item => item.name === 'display' && item.props.role === 'stage');
        const currentControls = shown.visible.filter(item => item.name === 'select' || item.name === 'range');
        const current = charts[0];
        stageValid &&= display.length === 1 && display[0].rendered === STAGES[stage] && display[0].ancestors.includes(pinned.node) && display[0].dependencies.value?.has(stageVar);
        resultValid &&= charts.length === 1 && currentControls.length === 2 && currentControls.every(enabled) && currentControls.find(item => item.name === 'select')?.props.value === category && currentControls.find(item => item.name === 'range')?.props.value === threshold && current?.props.type === 'line' && current.props.x === 'month' && current.props.y === 'sales' && current.props.color === 'category' && current.ancestors.includes(pinned.node) && current.dependencies.data?.has('sales');
        if (!current) { resultValid = false; continue; }
        const selected = data.filter(row => row.category === category);
        resultValid &&= sameRows(current.props.data, stage <= 1 ? data : selected);
        resultValid &&= stage === 1 ? current.props.focus === category : current.props.focus === undefined || current.props.focus === '' || stage >= 2 && current.props.focus === category;
        if (stage === 2) {
          const reference = current.props.reference;
          resultValid &&= Array.isArray(reference) && reference.length === averages.length && averages.every(expected => reference.filter(row => row?.month === expected.month && Number.isFinite(row.sales) && Math.abs(row.sales - expected.sales) < 0.000001).length === 1) && current.dependencies.reference?.has('sales');
        } else resultValid &&= empty(current.props.reference);
        resultValid &&= stage === 3 ? sameRows(current.props.highlight, selected.filter(row => row.sales > threshold)) : empty(current.props.highlight);
      }
    } catch (error) { resultValid = false; detail = error.message; }
    tests.push(test('stage-display', 'Reactive stage name in the pinned region', stageValid, 'Display role:"stage" must show Overview, Focus, Average, or Threshold for the current step.'));
    tests.push(test('story-states', 'Chart behavior across categories, thresholds, and forward/reverse stages', resultValid, detail));
    return tests;
  }

  if (!controlOK || !chartShape || staticTables.length !== 1) return tests;
  let viewsValid = true;
  let summaryValid = true;
  let emptyValid = true;
  let detail = 'Use the same doubly-filtered sales data for the table, chart, and summary.';
  try {
    for (const category of expectedOptions) for (let threshold = 0; threshold <= 500; threshold += 10) {
      const expected = data.filter(row => (category === 'All' || row.category === category) && row.sales >= threshold);
      const shown = state({[categoryVar]:category,[thresholdVar]:threshold});
      const tables = shown.visible.filter(item => item.name === 'table');
      const charts = shown.visible.filter(item => item.name === 'chart');
      const currentControls = shown.visible.filter(item => item.name === 'select' || item.name === 'range');
      viewsValid &&= tables.length === 1 && charts.length === 1 && currentControls.length === 2 && currentControls.every(enabled) && currentControls.find(item => item.name === 'select')?.props.value === category && currentControls.find(item => item.name === 'range')?.props.value === threshold && sameRows(tables[0]?.props.data, expected) && sameRows(charts[0]?.props.data, expected) && tables[0]?.dependencies.data?.has('sales') && charts[0]?.dependencies.data?.has('sales') && charts[0]?.props.type === 'point' && charts[0]?.props.x === 'month' && charts[0]?.props.y === 'sales' && charts[0]?.props.color === 'category' && empty(charts[0]?.props.reference) && empty(charts[0]?.props.highlight) && !charts[0]?.props.focus;
      const total = expected.reduce((sum,row) => sum + row.sales, 0);
      for (const [role,value] of [['count',expected.length],['total',total],['average',expected.length ? total / expected.length : '—']]) {
        const matches = shown.visible.filter(item => item.name === 'display' && item.props.role === role);
        summaryValid &&= matches.length === 1 && matches[0].dependencies.value?.has('sales');
        if (typeof value === 'number') summaryValid &&= matches.length === 1 && Math.abs(Number(matches[0].rendered.replace(/[$,]/g,'')) - value) < 0.011;
        else summaryValid &&= matches.length === 1 && matches[0].rendered === value;
      }
      const emptyMessages = shown.text.match(/No matching records\./g) || [];
      emptyValid &&= emptyMessages.length === (expected.length ? 0 : 1);
    }
  } catch (error) { viewsValid = false; summaryValid = false; emptyValid = false; detail = error.message; }
  tests.push(test('filtered-views', 'Table and chart apply both filters for every control combination', viewsValid, detail));
  tests.push(test('summary', 'Reactive record count, total, and average', summaryValid, 'Use Display role:"count", role:"total", and role:"average" with the filtered data; use — for the empty average.'));
  tests.push(test('empty-state', 'Empty results clear both views and show the required message', emptyValid && viewsValid, 'Show exactly No matching records. only for empty results, with empty table/chart data.'));
  return tests;
}

module.exports = {check};
