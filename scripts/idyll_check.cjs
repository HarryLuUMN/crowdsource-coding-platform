const fs = require('node:fs');
const acorn = require('acorn');

function check(ast, task) {
  const definitions = new Map();
  const controls = [];
  const declarations = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'var' || node.type === 'derived') {
      const name = node.properties?.name?.value;
      if (typeof name !== 'string' || definitions.has(name)) throw Error('Use unique variable names.');
      definitions.set(name, node.properties.value);
    }
    if (['range', 'textinput'].includes(String(node.name).toLowerCase().replace(/-/g, ''))) controls.push(node);
    (node.children || []).forEach(declarations);
  };
  declarations(ast);
  const expression = (text, resolve) => {
    const tree = acorn.parseExpressionAt(text, 0, { ecmaVersion: 2020 });
    if (text.slice(tree.end).trim()) throw Error('Only a single expression can be checked.');
    let budget = 500;
    const visit = node => {
      if (--budget < 0) throw Error('Expression is too complex.');
      const both = fn => fn(visit(node.left), visit(node.right));
      switch (node.type) {
        case 'Literal':
          if (!['number', 'string', 'boolean'].includes(typeof node.value)) throw Error('Unsupported literal.');
          return node.value;
        case 'Identifier': return resolve(node.name);
        case 'BinaryExpression':
          switch (node.operator) {
            case '+': return both((a,b)=>a+b); case '-': return both((a,b)=>a-b);
            case '*': return both((a,b)=>a*b); case '/': return both((a,b)=>a/b);
            case '%': return both((a,b)=>a%b); case '**': return both((a,b)=>a**b);
            case '<': return both((a,b)=>a<b); case '<=': return both((a,b)=>a<=b);
            case '>': return both((a,b)=>a>b); case '>=': return both((a,b)=>a>=b);
            case '==': return both((a,b)=>a==b); case '===': return both((a,b)=>a===b);
            case '!=': return both((a,b)=>a!=b); case '!==': return both((a,b)=>a!==b);
          }
          break;
        case 'LogicalExpression':
          if (node.operator === '&&') return visit(node.left) && visit(node.right);
          if (node.operator === '||') return visit(node.left) || visit(node.right);
          break;
        case 'UnaryExpression':
          if (node.operator === '-') return -visit(node.argument);
          if (node.operator === '+') return +visit(node.argument);
          if (node.operator === '!') return !visit(node.argument);
          break;
        case 'ConditionalExpression': return visit(node.test) ? visit(node.consequent) : visit(node.alternate);
        case 'CallExpression': {
          const target = node.callee;
          const functions = { round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, min: Math.min, max: Math.max, pow: Math.pow };
          if (target.type === 'MemberExpression' && !target.computed && target.object.type === 'Identifier' && target.object.name === 'Math' && Object.hasOwn(functions, target.property.name)) {
            return functions[target.property.name](...node.arguments.map(visit));
          }
          break;
        }
      }
      throw Error(`This expression uses ${node.type}, which the task checker cannot safely evaluate. Use arithmetic, comparisons, conditional expressions and Math helpers.`);
    };
    return visit(tree);
  };
  const evaluate = (property, overrides, trail = new Set()) => {
    if (!property) return undefined;
    const resolve = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (!definitions.has(name)) throw Error(`Unknown variable: ${name}`);
      if (trail.has(name)) throw Error('Circular variable definitions.');
      return evaluate(definitions.get(name), overrides, new Set([...trail, name]));
    };
    if (property.type === 'value') return property.value;
    if (property.type === 'variable') return resolve(property.value);
    if (property.type === 'expression') return expression(property.value, resolve);
    throw Error('Unsupported property expression.');
  };
  const render = (overrides) => {
    const numbers = [];
    let text = '';
    const visit = node => {
      if (node.type === 'textnode') { text += `${node.value} `; return; }
      if (node.type !== 'component') return;
      const name = String(node.name).toLowerCase().replace(/-/g, '');
      if (name === 'conditional' && !evaluate(node.properties?.if, overrides)) return;
      if (name === 'display' || name === 'dynamic') {
        const value = evaluate(node.properties?.value, overrides);
        if (Number.isFinite(Number(value)) && value !== '') numbers.push(Number(value));
        text += `${value} `;
      }
      if (name === 'switch') {
        const value = evaluate(node.properties?.value, overrides);
        let chosen = (node.children || []).find(child => String(child.name).toLowerCase() === 'case' && evaluate(child.properties?.test, overrides) === value);
        if (!chosen) chosen = (node.children || []).find(child => String(child.name).toLowerCase() === 'default');
        if (chosen) (chosen.children || []).forEach(visit);
        return;
      }
      (node.children || []).forEach(visit);
    };
    visit(ast);
    return {numbers,text};
  };
  const maximum = task === 'idyll-calculator-v1' ? 10 : 100;
  const candidates = controls.filter(control => {
    const bound = control.properties?.value;
    if (bound?.type !== 'variable' || !definitions.has(bound.value)) return false;
    if (task !== 'idyll-converter-v1' && String(control.name).toLowerCase() !== 'range') return false;
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
        const has = expected => shown.numbers.some(number => Math.abs(number - expected) < 0.011);
        if (task === 'idyll-calculator-v1') correct &&= has(value) && has(value * 5);
        else if (task === 'idyll-converter-v1') correct &&= has(value * 9 / 5 + 32);
        else {
          const label = value < 30 ? 'Low' : value < 70 ? 'Medium' : 'High';
          const labels = shown.text.match(/\b(Low|Medium|High)\b/g) || [];
          correct &&= has(value) && labels.length === 1 && labels[0] === label;
        }
      }
      if (correct) verified = true;
    } catch (error) { detail = error.message; }
  }
  tests.push({id:'reactive-output', label:'Reactive output across the input range', passed:verified, message:verified ? 'Required output verified at every integer input in the specified range.' : detail});
  return tests;
}
try {
  const input = JSON.parse(fs.readFileSync(0,'utf8'));
  const tests = check(input.ast,input.task_id);
  process.stdout.write(JSON.stringify({tests}));
} catch(error) {
  process.stdout.write(JSON.stringify({tests:[{id:'safe-evaluation',label:'Supported reactive program',passed:false,message:error.message}]}));
}
