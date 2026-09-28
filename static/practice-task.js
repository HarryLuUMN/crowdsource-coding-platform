(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PracticeTask = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const expectedOutput = "Hello, coding platform!";

  function check(source) {
    const meaningfulLines = String(source)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    const match = meaningfulLines.length === 1
      ? meaningfulLines[0].match(/^print\(\s*(["'])(.*?)\1\s*\);?$/)
      : null;
    const passed = Boolean(match && match[2] === expectedOutput);
    return {
      passed,
      output: passed ? expectedOutput : "",
      message: passed
        ? "Your program prints the requested message."
        : "Write one Python print statement that outputs the requested message exactly.",
    };
  }

  return { check, expectedOutput };
});
