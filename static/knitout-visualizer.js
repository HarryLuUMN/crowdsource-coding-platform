(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KnitoutVisualizer = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const STITCH_COMMANDS = new Set(["knit", "tuck", "split"]);

  function parseNeedle(value) {
    const match = /^([fb])s?(-?\d+)$/.exec(value || "");
    return match ? { bed: match[1], needle: Number(match[2]), key: `${match[1]}${match[2]}` } : null;
  }

  function operationNeedle(parts) {
    if (parts[0] === "split") return parseNeedle(parts[2]);
    return parseNeedle(parts[2]);
  }

  function parseKnitout(knitout) {
    const operations = String(knitout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith(";"))
      .map((line, sourceIndex) => ({ parts: line.split(/\s+/), sourceIndex }));
    const courses = [];
    const loops = [];
    const connections = [];
    const loopOnNeedle = new Map();
    let activeCourse = null;
    let lastDirection = null;

    operations.forEach(({ parts, sourceIndex }) => {
      const command = parts[0];
      if (command === "xfer" && parts.length >= 3) {
        const from = parseNeedle(parts[1]);
        const to = parseNeedle(parts[2]);
        if (from && to && loopOnNeedle.has(from.key)) {
          loopOnNeedle.set(to.key, loopOnNeedle.get(from.key));
          loopOnNeedle.delete(from.key);
        }
        return;
      }
      if (command === "drop") {
        const needle = parseNeedle(parts[1]);
        if (needle) loopOnNeedle.delete(needle.key);
        return;
      }
      if (!STITCH_COMMANDS.has(command)) return;
      const direction = parts[1];
      const needle = operationNeedle(parts);
      if (!needle) return;
      if (!activeCourse || (lastDirection && direction !== lastDirection)) {
        activeCourse = { index: courses.length, direction, loopIds: [] };
        courses.push(activeCourse);
      }
      const loop = {
        id: loops.length,
        course: activeCourse.index,
        needle: needle.needle,
        bed: needle.bed,
        command,
        direction,
        sourceIndex,
      };
      const parent = loopOnNeedle.get(needle.key);
      if (parent !== undefined) connections.push({ from: parent, to: loop.id, type: "wale" });
      loops.push(loop);
      activeCourse.loopIds.push(loop.id);
      loopOnNeedle.set(needle.key, loop.id);
      lastDirection = direction;
    });

    return {
      loops,
      courses,
      connections,
      operationCount: operations.length,
      stitchCount: loops.length,
    };
  }

  function render(container, knitout, suppliedMetrics = {}) {
    const model = parseKnitout(knitout);
    container.replaceChildren();
    if (!model.loops.length) {
      const empty = document.createElement("div");
      empty.className = "visualization-empty";
      empty.innerHTML = "<strong>No stitch structure to visualize</strong><span>Run code that produces knitout to see its loop and course graph.</span>";
      container.append(empty);
      return model;
    }

    const stats = document.createElement("div");
    stats.className = "visualization-stats";
    const values = [
      [suppliedMetrics.loops ?? model.loops.length, "Loops"],
      [suppliedMetrics.stitches ?? model.stitchCount, "Stitches"],
      [suppliedMetrics.courses ?? model.courses.length, "Courses"],
      [model.operationCount, "Knitout"],
    ];
    values.forEach(([value, label]) => {
      const card = document.createElement("div");
      card.className = "visualization-stat";
      card.innerHTML = `<strong>${Number(value) || 0}</strong><span>${label}</span>`;
      stats.append(card);
    });

    const chart = document.createElement("div");
    chart.className = "visualization-chart";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Knitout loop and course structure");
    const needles = model.loops.map((loop) => loop.needle);
    const minNeedle = Math.min(...needles);
    const maxNeedle = Math.max(...needles);
    const needleSpan = Math.max(1, maxNeedle - minNeedle);
    const width = Math.max(640, needleSpan * 72 + 180);
    const height = Math.max(230, model.courses.length * 92 + 90);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const positions = new Map();
    const xFor = (needle) => 64 + ((needle - minNeedle) / needleSpan) * (width - 150);
    const yFor = (course) => height - 52 - course * 92;

    model.courses.forEach((course) => {
      const y = yFor(course.index);
      const guide = document.createElementNS(svg.namespaceURI, "line");
      guide.setAttribute("x1", "42");
      guide.setAttribute("x2", String(width - 50));
      guide.setAttribute("y1", String(y));
      guide.setAttribute("y2", String(y));
      guide.setAttribute("class", "course-guide");
      svg.append(guide);
      const label = document.createElementNS(svg.namespaceURI, "text");
      label.setAttribute("x", String(width - 42));
      label.setAttribute("y", String(y - 12));
      label.setAttribute("text-anchor", "end");
      label.setAttribute("class", "course-label");
      label.textContent = `course ${course.index}`;
      svg.append(label);
      course.loopIds.forEach((id) => {
        const loop = model.loops[id];
        positions.set(id, { x: xFor(loop.needle), y });
      });
    });

    model.connections.forEach((connection) => {
      const from = positions.get(connection.from);
      const to = positions.get(connection.to);
      if (!from || !to) return;
      const line = document.createElementNS(svg.namespaceURI, "line");
      line.setAttribute("x1", String(from.x));
      line.setAttribute("y1", String(from.y));
      line.setAttribute("x2", String(to.x));
      line.setAttribute("y2", String(to.y));
      line.setAttribute("class", "loop-connection");
      svg.append(line);
    });

    model.courses.forEach((course) => {
      const courseLoops = course.loopIds.map((id) => model.loops[id]);
      courseLoops.slice(1).forEach((loop, index) => {
        const previous = positions.get(courseLoops[index].id);
        const current = positions.get(loop.id);
        const line = document.createElementNS(svg.namespaceURI, "line");
        line.setAttribute("x1", String(previous.x));
        line.setAttribute("y1", String(previous.y));
        line.setAttribute("x2", String(current.x));
        line.setAttribute("y2", String(current.y));
        line.setAttribute("class", "course-connection");
        svg.append(line);
      });
    });

    model.loops.forEach((loop) => {
      const position = positions.get(loop.id);
      const group = document.createElementNS(svg.namespaceURI, "g");
      group.setAttribute("class", `loop-node loop-${loop.command}`);
      const circle = document.createElementNS(svg.namespaceURI, "circle");
      circle.setAttribute("cx", String(position.x));
      circle.setAttribute("cy", String(position.y));
      circle.setAttribute("r", "18");
      const text = document.createElementNS(svg.namespaceURI, "text");
      text.setAttribute("x", String(position.x));
      text.setAttribute("y", String(position.y + 4));
      text.setAttribute("text-anchor", "middle");
      text.textContent = String(loop.id);
      const title = document.createElementNS(svg.namespaceURI, "title");
      title.textContent = `${loop.command} ${loop.direction} ${loop.bed}${loop.needle}`;
      group.append(circle, text, title);
      svg.append(group);
    });

    chart.append(svg);
    container.append(stats, chart);
    return model;
  }

  return { parseKnitout, render };
});
