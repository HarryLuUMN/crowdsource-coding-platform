function documentationReadingSnapshot(frame) {
  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  const blocks = [...doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p,pre,li,dt,dd")]
    .filter((block) => !block.querySelector("p,pre,li"));
  let section = null;
  let textBudget = 12000;
  const visible = [];
  blocks.forEach((block, index) => {
    const text = block.textContent.trim();
    if (/^H[1-6]$/.test(block.tagName)) section = text;
    const rect = block.getBoundingClientRect();
    if (!text || rect.bottom <= 0 || rect.top >= view.innerHeight || rect.right <= 0 || rect.left >= view.innerWidth) return;
    const excerpt = text.slice(0, Math.min(2000, textBudget));
    textBudget = Math.max(0, textBudget - excerpt.length);
    visible.push({
      block_id: block.id || `reading-block-${index}`,
      block_index: index,
      tag: block.tagName.toLowerCase(),
      section,
      text: excerpt,
      text_length: text.length,
      text_truncated: excerpt.length < text.length,
      partially_visible: rect.top < 0 || rect.bottom > view.innerHeight || rect.left < 0 || rect.right > view.innerWidth,
      viewport_top: Math.round(rect.top),
      viewport_bottom: Math.round(rect.bottom),
    });
  });
  return {
    guide_kind: view.location.pathname === "/tutorial.html" ? "tutorial" : "documentation",
    page_url: view.location.href,
    document_path: view.location.pathname + view.location.hash,
    observed_at: new Date().toISOString(),
    scroll_x: Math.round(view.scrollX),
    scroll_y: Math.round(view.scrollY),
    viewport_width: view.innerWidth,
    viewport_height: view.innerHeight,
    document_height: doc.documentElement.scrollHeight,
    visible_blocks: visible,
    position_start: visible[0]?.block_id || null,
    position_end: visible.at(-1)?.block_id || null,
    platform_visible: !document.hidden,
  };
}

function attachDocumentationReading(frame, record) {
  let cleanup = () => {};
  const bind = () => {
    cleanup();
    const view = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!doc || !(view.location.pathname.startsWith("/documentation/") || view.location.pathname === "/tutorial.html")) return;
    let timer;
    let lastScroll = 0;
    const emit = (type, extra = {}) => record(type, { ...documentationReadingSnapshot(frame), ...extra });
    const scroll = () => {
      const now = performance.now();
      if (now - lastScroll >= 500) {
        emit("guide.documentation_scrolled", { phase: "scroll" });
        lastScroll = now;
      }
      clearTimeout(timer);
      timer = setTimeout(() => emit("guide.documentation_scrolled", { phase: "settled" }), 200);
    };
    const click = (event) => {
      const link = event.target.closest?.("a[href]");
      emit(link ? "guide.documentation_link_clicked" : "guide.documentation_clicked", link ? { target_url: link.href, target_path: link.getAttribute("href") } : {});
    };
    const navigate = () => emit("guide.documentation_navigated", { navigation_kind: "fragment" });
    const resize = () => emit("guide.documentation_viewport_changed");
    const leave = () => {
      clearTimeout(timer);
      emit("guide.documentation_view_left");
    };
    view.addEventListener("scroll", scroll, { passive: true });
    doc.addEventListener("click", click);
    view.addEventListener("hashchange", navigate);
    view.addEventListener("resize", resize);
    view.addEventListener("pagehide", leave);
    cleanup = () => {
      clearTimeout(timer);
      view.removeEventListener("scroll", scroll);
      doc.removeEventListener("click", click);
      view.removeEventListener("hashchange", navigate);
      view.removeEventListener("resize", resize);
      view.removeEventListener("pagehide", leave);
    };
    emit("guide.documentation_navigated", { navigation_kind: "page" });
  };
  frame.addEventListener("load", bind);
  if (frame.contentDocument?.readyState === "complete") bind();
  return () => {
    if (frame.contentDocument && (frame.contentWindow.location.pathname.startsWith("/documentation/") || frame.contentWindow.location.pathname === "/tutorial.html")) {
      record("guide.documentation_view_left", documentationReadingSnapshot(frame));
    }
  };
}

if (typeof module !== "undefined") module.exports = { documentationReadingSnapshot, attachDocumentationReading };
