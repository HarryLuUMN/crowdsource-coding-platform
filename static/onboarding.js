(function () {
  let activeTour = null;
  let pendingTour = null;

  function start({ required = false } = {}) {
    if (pendingTour) return pendingTour;
    const intro = window.introJs;
    if (!intro || typeof intro.tour !== "function") return Promise.resolve(false);
    const definitions = [
      ["#taskProgress", "Complete three tasks in order", "Start at Level 1. Passing and submitting each task unlocks the next level. Yellow indicates your current task, gray indicates a locked task, and green indicates a passed task."],
      ["#taskDescription", "Read the task requirements", "Build your program from scratch to satisfy the requirements shown here. Each task is expected to take about 20 minutes."],
      ["#sourceEditor", "Write your program here", "You can edit and run your code as many times as needed before submitting."],
      [".documentation-panel", "Use the provided learning materials", "Consult the Documentation and Tutorial while programming. Follow the independent-work rules shown above the editor."],
      ["#runButton", "Run to check your work", "Run executes your program and displays feedback. Review the Visualization, Test Results, and Console to identify what needs revision. Running does not submit your answer."],
      ["[data-tab='tests']", "Check every requirement", "A program can run successfully without satisfying the task. Your solution passes when all task checks pass. If a check fails, revise your program and run it again."],
      ["#submitButton", "Submit when you are ready", "Submit checks your current program again. If it passes, your code and trace are saved before the next task opens. If it fails, stay on the current task and keep revising. After Level 3, follow the completion instructions."]
    ];
    const steps = definitions.map(([selector, title, description]) => {
      let element = document.querySelector(selector);
      if (selector === "#taskProgress" && (!element || element.hidden || !element.getClientRects().length)) element = document.querySelector(".task-title-row");
      if (selector === "#submitButton" && element?.hidden) element = document.querySelector(".result-actions");
      return { element, title, intro: description, position: "bottom" };
    });
    if (steps.some(step => !step.element || step.element.hidden)) return Promise.resolve(false);
    const highlightAction = target => {
      document.querySelectorAll(".studio-onboarding-action").forEach(element => element.classList.remove("studio-onboarding-action"));
      const isAction = target?.id === "runButton" || target?.id === "submitButton";
      document.body.classList.toggle("studio-onboarding-action-step", Boolean(isAction));
      if (isAction) target.classList.add("studio-onboarding-action");
    };
    const previousFocus = document.activeElement;
    let completed = false;
    pendingTour = new Promise(resolve => {
      let settled = false;
      const finish = success => {
        if (settled) return;
        settled = true;
        highlightAction(null);
        document.body.classList.remove("studio-onboarding-active");
        activeTour = null;
        pendingTour = null;
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
        resolve(success);
      };
      try {
        activeTour = intro.tour().setOptions({
          steps,
          tooltipClass: "studio-onboarding-tooltip",
          highlightClass: "studio-onboarding-highlight",
          nextLabel: "Next",
          prevLabel: "Back",
          skipLabel: "Close",
          doneLabel: required ? "Start Level 1" : "Back to task",
          showProgress: true,
          showBullets: false,
          showStepNumbers: true,
          tooltipRenderAsHtml: false,
          disableInteraction: true,
          exitOnOverlayClick: false,
          exitOnEsc: true,
          scrollToElement: true,
          scrollPadding: 20,
          overlayOpacity: 0.65,
          helperElementPadding: 6
        });
        document.body.classList.add("studio-onboarding-active");
        activeTour.onAfterChange(highlightAction);
        activeTour.onComplete((_step, reason) => { completed = reason === "done" || reason === "end"; });
        activeTour.onExit(() => finish(completed));
        Promise.resolve(activeTour.start()).catch(() => finish(false));
      } catch (_error) {
        if (activeTour) Promise.resolve(activeTour.exit(true)).catch(() => {});
        finish(false);
      }
    });
    return pendingTour;
  }

  window.StudioOnboarding = { start, isActive: () => activeTour !== null };
})();
