(() => {
  "use strict";

  const chapters = [...document.querySelectorAll(".module")];
  const navLinks = [...document.querySelectorAll('.chapter-nav a[href^="#"]')];
  const progress = document.querySelector("#read-progress");

  function updateReadingPosition() {
    const range = document.documentElement.scrollHeight - innerHeight;
    const percentage = range > 0 ? Math.min(100, Math.max(0, Math.round(scrollY / range * 100))) : 100;
    progress.style.width = `${percentage}%`;
    progress.setAttribute("aria-valuenow", String(percentage));
    let current = chapters[0];
    for (const chapter of chapters) {
      if (chapter.getBoundingClientRect().top <= innerHeight * .42) current = chapter;
    }
    navLinks.forEach(link => {
      if (link.hash === `#${current.id}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }
  addEventListener("scroll", () => requestAnimationFrame(updateReadingPosition), { passive: true });
  addEventListener("resize", updateReadingPosition);
  updateReadingPosition();

  document.querySelectorAll("[data-tabs]").forEach(group => {
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    const panels = [...group.querySelectorAll('[role="tabpanel"]')];
    function select(index, focus = false) {
      tabs.forEach((tab, i) => {
        const selected = i === index;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (focus && selected) tab.focus();
      });
      panels.forEach((panel, i) => { panel.hidden = i !== index; });
    }
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(i));
      tab.addEventListener("keydown", event => {
        let next;
        if (event.key === "ArrowRight") next = (i + 1) % tabs.length;
        if (event.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        if (next !== undefined) { event.preventDefault(); select(next, true); }
      });
    });
    select(Math.max(0, tabs.findIndex(tab => tab.getAttribute("aria-selected") === "true")));
  });

  document.querySelectorAll("[data-stepper]").forEach(stepper => {
    const dots = [...stepper.querySelectorAll(".step-dot")];
    const panels = [...stepper.querySelectorAll(".step-panel")];
    const previous = stepper.querySelector(".step-prev");
    const next = stepper.querySelector(".step-next");
    const count = stepper.querySelector(".step-count");
    let index = 0;
    function show(position) {
      index = Math.max(0, Math.min(panels.length - 1, position));
      dots.forEach((dot, i) => {
        dot.classList.toggle("is-current", i === index);
        dot.setAttribute("aria-current", i === index ? "step" : "false");
      });
      panels.forEach((panel, i) => { panel.hidden = i !== index; });
      previous.disabled = index === 0;
      next.disabled = index === panels.length - 1;
      count.textContent = `${String(index + 1).padStart(2, "0")} / ${String(panels.length).padStart(2, "0")}`;
    }
    dots.forEach((dot, i) => dot.addEventListener("click", () => show(i)));
    previous.addEventListener("click", () => show(index - 1));
    next.addEventListener("click", () => show(index + 1));
    show(0);
  });

})();
