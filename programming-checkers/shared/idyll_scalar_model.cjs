const acorn = require('acorn');
const formatNumber = require('d3-format').format;

function createScalarModel(ast) {
  const definitions = new Map();
  const mutable = new Set();
  const controls = [];
  const declarations = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'var' || node.type === 'derived') {
      const name = node.properties?.name?.value;
      if (typeof name !== 'string' || definitions.has(name)) throw Error('Use unique variable names.');
      definitions.set(name, node.properties.value);
      if (node.type === "var") mutable.add(name);
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
  const evaluate = (property, overrides, trail = new Set(), accessed = new Set()) => {
    if (!property) return undefined;
    const resolve = name => {
      if (Object.hasOwn(overrides, name)) { accessed.add(name); return overrides[name]; }
      if (!definitions.has(name)) throw Error(`Unknown variable: ${name}`);
      if (trail.has(name)) throw Error('Circular variable definitions.');
      return evaluate(definitions.get(name), overrides, new Set([...trail, name]), accessed);
    };
    if (property.type === 'value') return property.value;
    if (property.type === 'variable') return resolve(property.value);
    if (property.type === 'expression') return expression(property.value, resolve);
    throw Error('Unsupported property expression.');
  };
  const render = (overrides) => {
    const numbers = [];
    const visibleControls = new Set();
    let text = '';
    const visit = node => {
      if (node.type === 'textnode') { text += `${node.value} `; return; }
      if (node.type !== 'component') return;
      const name = String(node.name).toLowerCase().replace(/-/g, '');
      if (name === 'conditional' && !evaluate(node.properties?.if, overrides)) return;
      if (node.properties?.style) throw Error('The task checker cannot verify custom styles; use unstyled built-in components.');
      if (name === 'range' || name === 'textinput') visibleControls.add(node.id);
      if (name === 'display' || name === 'dynamic') {
        const accessed = new Set();
        const property = name === 'dynamic' && node.properties?.display ? node.properties.display : node.properties?.value || node.properties?.var;
        const value = evaluate(property, overrides, new Set(), accessed);
        const format = evaluate(node.properties?.format, overrides) || '0.2f';
        const rendered = typeof value === 'number' ? formatNumber(format)(value) : String(value);
        const numeric = Number(rendered.replace(/[$,]/g, ''));
        if (Number.isFinite(numeric) && rendered !== '') numbers.push({value:numeric, reactive:Object.keys(overrides).some(name => accessed.has(name))});
        text += `${rendered} `;
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
    return {numbers,text,visibleControls};
  };
  for (const name of definitions.keys()) evaluate({type:'variable',value:name}, {});
  return {controls, mutable, evaluate, render};
}

module.exports = {createScalarModel};
