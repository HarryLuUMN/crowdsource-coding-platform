"use strict";

// Find the smallest enclosing text range that changed.
function unitChange(before, after) {
  let start = 0;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  // Remove matching edges; separate edits may remain inside one wide range.
  while (start < beforeEnd && start < afterEnd && before[start] === after[start]) start++;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--;
    afterEnd--;
  }
  return {
    start,
    end: beforeEnd,
    removed: before.slice(start, beforeEnd),
    inserted: after.slice(start, afterEnd),
  };
}

// Split on outer delimiters, not delimiters inside strings or brackets.
function unitSegments(text) {
  const segments = [];
  let start = 0, quote = "", escape = false, comment = false, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (comment) {
      if (c === "\n") comment = false;
      else continue;
    }
    if (quote) {
      // An escaped quote must not end the string.
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === quote) quote = "";
      continue;
    }
    // Legacy comment handling is retained for output compatibility.
    if (c === "#") {
      comment = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (depth === 0 && [";", "{", "}"].includes(c)) {
      segments.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  // Retain unfinished text even when no delimiter closes it.
  if (start < text.length) segments.push(text.slice(start));
  return segments;
}
