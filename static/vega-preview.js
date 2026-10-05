let view;
let generation = 0;
window.addEventListener("message", async event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.type !== "vega.render") return;
  const current = ++generation;
  try {
    if (view) view.finalize();
    document.querySelector("#chart").replaceChildren();
    document.querySelector("#error").textContent = "";
    const spec = structuredClone(event.data.spec);
    spec.data = { values: await (await fetch("/sales-data.json")).json() };
    if (current !== generation) return;
    const compiled = vegaLite.compile(spec).spec;
    view = new vega.View(vega.parse(compiled), {
      renderer: "svg", container: "#chart", hover: true,
      loader: { load: () => Promise.reject(new Error("External resources are disabled")) },
    });
    await view.runAsync();
    document.querySelector("#chart").addEventListener("click", () => {
      parent.postMessage({ type: "vega.interaction", interaction: "click" }, location.origin);
    }, { once: true });
  } catch (error) {
    document.querySelector("#error").textContent = error.message;
    parent.postMessage({ type: "vega.render_error", message: error.message }, location.origin);
  }
});
