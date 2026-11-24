const {createEvaluator} = require('./idyll_safe_expression.cjs');
const formatNumber = require('d3-format').format;

const kind = node => String(node.name || '').toLowerCase().replace(/-/g, '');
const rowKey = row => `${row.month}\u0000${row.category}\u0000${row.sales}`;
const sameRows = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && actual.every(row => row && typeof row.month === 'string' && typeof row.category === 'string' && Number.isFinite(row.sales)) && actual.map(rowKey).sort().join('\n') === expected.map(rowKey).sort().join('\n');
const empty = value => value === undefined || Array.isArray(value) && value.length === 0;
const test = (id, label, passed, message) => ({id, label, passed: Boolean(passed), message: passed ? 'Requirement satisfied.' : message});

function createModel(ast, data) {
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

  return {state, mutable, nodes};
}

module.exports = {createModel, kind, sameRows, empty, test};
