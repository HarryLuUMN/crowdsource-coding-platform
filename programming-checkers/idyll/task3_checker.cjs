const {createModel, kind, sameRows, empty, test} = require('../shared/idyll_model.cjs');

const CATEGORIES = ['Books', 'Games', 'Music'];

const STAGES = ['Overview', 'Focus', 'Average', 'Threshold'];

function check(ast, data) {
  const {state, mutable, nodes} = createModel(ast, data);
  const defaults = state({});
  const controls = defaults.visible.filter(item => item.name === 'select' || item.name === 'range');
  const select = controls.filter(item => item.name === 'select');
  const range = controls.filter(item => item.name === 'range');
  const binding = item => item?.node.properties?.value?.type === 'variable' && mutable.has(item.node.properties.value.value) ? item.node.properties.value.value : null;
  const optionValues = item => Array.isArray(item.props.options) ? item.props.options.map(option => typeof option === 'string' ? option : option?.value) : [];
  const expectedOptions = CATEGORIES;
  const exactOptions = select.length === 1 && JSON.stringify(optionValues(select[0])) === JSON.stringify(expectedOptions);
  const categoryVar = binding(select[0]);
  const thresholdVar = binding(range[0]);
  const enabled = item => item && !item.props.disabled;
  const controlOK = controls.length === 2 && exactOptions && categoryVar && thresholdVar && categoryVar !== thresholdVar && enabled(select[0]) && enabled(range[0]) && range[0].props.min === 0 && range[0].props.max === 500 && range[0].props.step === 10 && select[0].props.value === 'Books' && range[0].props.value === 150;
  const tests = [test('controls', 'Bound category and sales-threshold controls', controlOK, `Use one enabled Select (${expectedOptions.join(', ')}) and one Range from 0 to 500 with step 10, bound to distinct variables with the requested initial values.`)];
  const staticCharts = nodes.filter(item => kind(item.node) === 'chart');
  const staticScrollers = nodes.filter(item => kind(item.node) === 'scroller');
  const staticPinned = nodes.filter(item => kind(item.node) === 'pinned');
  const chart = defaults.visible.find(item => item.name === 'chart');
  const chartShape = staticCharts.length === 1 && chart && chart.props.type === 'line' && chart.props.x === 'month' && chart.props.y === 'sales' && chart.props.color === 'category';
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

module.exports = {check};
