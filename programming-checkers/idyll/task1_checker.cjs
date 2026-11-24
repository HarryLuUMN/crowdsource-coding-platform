const {createScalarModel} = require('../shared/idyll_scalar_model.cjs');

function check(ast, data) {
  const {controls, mutable, evaluate, render} = createScalarModel(ast);
  const maximum = 10;
  const candidates = controls.filter(control => {
    const bound = control.properties?.value;
    if (bound?.type !== 'variable' || !mutable.has(bound.value)) return false;
    if (evaluate(control.properties?.disabled, {})) return false;
    const step = evaluate(control.properties?.step, {});
    if (step !== undefined && Number(step) !== 1) return false;
    if (String(control.name).toLowerCase() !== 'range') return false;
    return Number(evaluate(control.properties?.min, {})) === 0 && Number(evaluate(control.properties?.max, {})) === maximum;
  });
  const tests = [{id:'control', label:'Input control and range', passed:candidates.length > 0, message:'Bind a control to a declared variable with the requested minimum and maximum.'}];
  let verified = false;
  let detail = 'Display the required reactive result for every input value.';
  for (const control of candidates) {
    try {
      const variable = control.properties.value.value;
      let correct = true;
      for (let value = 0; value <= maximum; value++) {
        const shown = render({[variable]:value});
        correct &&= shown.visibleControls.has(control.id);
        const has = expected => shown.numbers.some(number => number.reactive && Math.abs(number.value - expected) < 0.011);
        correct &&= has(value) && has(value * 5);
      }
      if (correct) verified = true;
    } catch (error) { detail = error.message; }
  }
  tests.push({id:'reactive-output', label:'Reactive output across the input range', passed:verified, message:verified ? 'Required output verified at every integer input in the specified range.' : detail});
  return tests;
}

module.exports = {check};
