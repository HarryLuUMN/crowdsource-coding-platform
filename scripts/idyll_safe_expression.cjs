const acorn = require('acorn');

const BLOCKED = new Set(['__proto__', 'prototype', 'constructor', 'caller', 'callee', 'arguments', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
const METHODS = new Set(['filter', 'map', 'reduce', 'find', 'findIndex', 'some', 'every', 'includes', 'slice']);
const MATH = {abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, min: Math.min, max: Math.max, pow: Math.pow};
const parsed = new Map();
const MAX_ARRAY = 2048;

function parse(text) {
  if (typeof text !== 'string' || text.length > 12000) throw Error('Expression exceeds the supported size.');
  if (parsed.has(text)) return parsed.get(text);
  const tree = acorn.parseExpressionAt(text, 0, {ecmaVersion: 2020, preserveParens: true});
  if (text.slice(tree.end).trim()) throw Error('Use a single expression.');
  let count = 0;
  const inspect = (node, depth) => {
    if (!node || typeof node !== 'object') return;
    if (++count > 2000 || depth > 60) throw Error('Expression nesting or size exceeds the supported limit.');
    for (const [key, child] of Object.entries(node)) {
      if (key === 'start' || key === 'end') continue;
      if (Array.isArray(child)) child.forEach(item => inspect(item, depth + 1));
      else if (child && typeof child === 'object') inspect(child, depth + 1);
    }
  };
  inspect(tree, 0);
  if (parsed.size >= 512) parsed.clear();
  parsed.set(text, tree);
  return tree;
}

function createEvaluator(resolve, limit = 60000) {
  let remaining = limit;
  const closures = new WeakSet();
  const step = () => { if (--remaining < 0) throw Error('Expression evaluation exceeded its operation budget.'); };
  const bounded = value => {
    if (typeof value === 'string' && value.length > 20000) throw Error('Expression produced too much text.');
    if (Array.isArray(value) && value.length > MAX_ARRAY) throw Error('Expression produced too many values.');
    return value;
  };
  const keyOf = (node, scope, depth) => {
    const key = node.computed ? visit(node.property, scope, depth + 1) : node.property.name;
    if (!['string', 'number'].includes(typeof key) || BLOCKED.has(String(key))) throw Error('Unsafe property access is not supported.');
    return String(key);
  };
  const callback = (closure, args, depth) => {
    step();
    if (!closure || !closures.has(closure)) throw Error('Array operations require an arrow expression callback.');
    const scope = new Map(closure.scope);
    closure.node.params.forEach((param, index) => scope.set(param.name, args[index]));
    return visit(closure.node.body, scope, depth + 1);
  };
  const visit = (node, scope = new Map(), depth = 0) => {
    step();
    if (!node || depth > 80) throw Error('Expression nesting exceeds the supported limit.');
    const scalar = value => { if (value !== null && (typeof value === 'object' || typeof value === 'function')) throw Error('Only scalar values can be coerced in expressions.'); return value; };
    const binary = fn => bounded(fn(scalar(visit(node.left, scope, depth + 1)), scalar(visit(node.right, scope, depth + 1))));
    switch (node.type) {
      case 'ParenthesizedExpression': return visit(node.expression, scope, depth + 1);
      case 'Literal':
        if (node.regex || typeof node.value === 'bigint') throw Error('Only simple literal values are supported.');
        return bounded(node.value);
      case 'Identifier':
        if (BLOCKED.has(node.name)) throw Error('Unsafe identifier.');
        return scope.has(node.name) ? scope.get(node.name) : resolve(node.name);
      case 'ArrayExpression':
        if (node.elements.length > MAX_ARRAY || node.elements.some(item => !item || item.type === 'SpreadElement')) throw Error('Use a bounded array without spread syntax.');
        return node.elements.map(item => visit(item, scope, depth + 1));
      case 'ObjectExpression': {
        if (node.properties.length > 128) throw Error('Object has too many properties.');
        const object = Object.create(null);
        for (const item of node.properties) {
          if (item.type !== 'Property' || item.kind !== 'init' || item.method || item.computed) throw Error('Only plain object properties are supported.');
          const key = item.key.type === 'Identifier' ? item.key.name : String(item.key.value);
          if (BLOCKED.has(key)) throw Error('Unsafe object key.');
          object[key] = visit(item.value, scope, depth + 1);
        }
        return object;
      }
      case 'MemberExpression': {
        const object = visit(node.object, scope, depth + 1);
        const key = keyOf(node, scope, depth);
        if (object === null || object === undefined) throw Error('Cannot read a property of an absent value.');
        if ((Array.isArray(object) || typeof object === 'string') && key === 'length') return object.length;
        if ((typeof object === 'object' || typeof object === 'string') && Object.hasOwn(object, key)) return object[key];
        throw Error(`Unsupported property: ${key}`);
      }
      case 'ArrowFunctionExpression': {
        if (node.async || node.body.type === 'BlockStatement' || node.params.length > 4 || node.params.some(param => param.type !== 'Identifier' || BLOCKED.has(param.name))) throw Error('Use an arrow callback with simple parameters and a single expression.');
        const closure = {node, scope: new Map(scope)};
        closures.add(closure);
        return closure;
      }
      case 'BinaryExpression':
        switch (node.operator) {
          case '+': return binary((a,b) => a + b); case '-': return binary((a,b) => a - b);
          case '*': return binary((a,b) => a * b); case '/': return binary((a,b) => a / b);
          case '%': return binary((a,b) => a % b); case '**': return binary((a,b) => a ** b);
          case '<': return binary((a,b) => a < b); case '<=': return binary((a,b) => a <= b);
          case '>': return binary((a,b) => a > b); case '>=': return binary((a,b) => a >= b);
          case '===': return binary((a,b) => a === b); case '!==': return binary((a,b) => a !== b);
          case '==': return binary((a,b) => a == b); case '!=': return binary((a,b) => a != b);
        }
        break;
      case 'LogicalExpression':
        if (node.operator === '&&') return visit(node.left, scope, depth + 1) && visit(node.right, scope, depth + 1);
        if (node.operator === '||') return visit(node.left, scope, depth + 1) || visit(node.right, scope, depth + 1);
        if (node.operator === '??') { const value = visit(node.left, scope, depth + 1); return value == null ? visit(node.right, scope, depth + 1) : value; }
        break;
      case 'UnaryExpression':
        if (node.operator === '!') return !visit(node.argument, scope, depth + 1);
        if (node.operator === '-') return -scalar(visit(node.argument, scope, depth + 1));
        if (node.operator === '+') return +scalar(visit(node.argument, scope, depth + 1));
        break;
      case 'ConditionalExpression': return visit(node.test, scope, depth + 1) ? visit(node.consequent, scope, depth + 1) : visit(node.alternate, scope, depth + 1);
      case 'CallExpression': {
        const target = node.callee;
        if (node.optional || target.type !== 'MemberExpression' || node.arguments.some(arg => arg.type === 'SpreadElement')) break;
        const method = keyOf(target, scope, depth);
        if (target.object.type === 'Identifier' && target.object.name === 'Math' && !scope.has('Math') && Object.hasOwn(MATH, method)) {
          if (node.arguments.length > 64) throw Error('Too many Math arguments.');
          const values = node.arguments.map(arg => visit(arg, scope, depth + 1));
          if (values.some(value => typeof value !== 'number')) throw Error('Math helpers require numeric values.');
          return MATH[method](...values);
        }
        const array = visit(target.object, scope, depth + 1);
        if (!Array.isArray(array) || !METHODS.has(method) || array.length > MAX_ARRAY || node.arguments.length > 2) throw Error('Only bounded, non-mutating array operations are supported.');
        const args = node.arguments.map(arg => visit(arg, scope, depth + 1));
        if (method === 'slice') { if (args.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw Error('Slice bounds must be finite numbers.'); return bounded(array.slice(...args)); }
        if (method === 'includes') { if (args.length > 1 && (typeof args[1] !== 'number' || !Number.isFinite(args[1]))) throw Error('Includes offset must be a finite number.'); const offset = Math.trunc(args[1] || 0); for (let index = offset < 0 ? Math.max(array.length + offset, 0) : offset; index < array.length; index++) { step(); if (array[index] === args[0]) return true; } return false; }
        if (method === 'reduce') {
          if (!args.length || (!array.length && args.length < 2)) throw Error('Empty reductions need an initial value.');
          let accumulator = args.length > 1 ? args[1] : array[0];
          for (let index = args.length > 1 ? 0 : 1; index < array.length; index++) accumulator = bounded(callback(args[0], [accumulator, array[index], index, array], depth));
          return accumulator;
        }
        const result = [];
        for (let index = 0; index < array.length; index++) {
          const value = callback(args[0], [array[index], index, array], depth);
          if (method === 'map') result.push(value);
          if (method === 'filter' && value) result.push(array[index]);
          if (method === 'find' && value) return array[index];
          if (method === 'findIndex' && value) return index;
          if (method === 'some' && value) return true;
          if (method === 'every' && !value) return false;
        }
        if (method === 'find') return undefined;
        if (method === 'findIndex') return -1;
        if (method === 'some') return false;
        if (method === 'every') return true;
        return bounded(result);
      }
    }
    throw Error(`Unsupported safe expression: ${node.type}. Use documented expressions without arbitrary JavaScript calls.`);
  };
  return text => visit(parse(text));
}

module.exports = {createEvaluator};
