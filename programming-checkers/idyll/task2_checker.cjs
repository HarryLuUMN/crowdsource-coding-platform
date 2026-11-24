const {createModel, kind, sameRows, empty, test} = require('../shared/idyll_model.cjs');

const CATEGORIES = ['Books', 'Games', 'Music'];

function check(ast, data) {
  const {state, mutable, nodes} = createModel(ast, data);
  const defaults = state({});
  const controls = defaults.visible.filter(item => item.name === 'select' || item.name === 'range');
  const select = controls.filter(item => item.name === 'select');
  const range = controls.filter(item => item.name === 'range');
  const binding = item => item?.node.properties?.value?.type === 'variable' && mutable.has(item.node.properties.value.value) ? item.node.properties.value.value : null;
  const optionValues = item => Array.isArray(item.props.options) ? item.props.options.map(option => typeof option === 'string' ? option : option?.value) : [];
  const expectedOptions = ['All', ...CATEGORIES];
  const exactOptions = select.length === 1 && JSON.stringify(optionValues(select[0])) === JSON.stringify(expectedOptions);
  const categoryVar = binding(select[0]);
  const thresholdVar = binding(range[0]);
  const enabled = item => item && !item.props.disabled;
  const controlOK = controls.length === 2 && exactOptions && categoryVar && thresholdVar && categoryVar !== thresholdVar && enabled(select[0]) && enabled(range[0]) && range[0].props.min === 0 && range[0].props.max === 500 && range[0].props.step === 10 && select[0].props.value === 'All' && range[0].props.value === 0;
  const tests = [test('controls', 'Bound category and sales-threshold controls', controlOK, `Use one enabled Select (${expectedOptions.join(', ')}) and one Range from 0 to 500 with step 10, bound to distinct variables with the requested initial values.`)];
  const staticCharts = nodes.filter(item => kind(item.node) === 'chart');
  const staticTables = nodes.filter(item => kind(item.node) === 'table');
  const chart = defaults.visible.find(item => item.name === 'chart');
  const chartShape = staticCharts.length === 1 && chart && chart.props.type === 'point' && chart.props.x === 'month' && chart.props.y === 'sales' && chart.props.color === 'category';
  tests.push(test('views', 'Linked table and point chart', staticTables.length === 1 && chartShape, 'Use exactly one Table and one Chart with type:"point", x:"month", y:"sales", color:"category".'));

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
