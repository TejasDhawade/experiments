// ---------- 1. Footer year ----------
// Puts the current year in the footer so it never goes out of date.
document.getElementById("year").textContent = new Date().getFullYear();

// ---------- 2. Mobile menu ----------
const menuToggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".nav");

menuToggle.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", isOpen);
});

// Close the menu after tapping a link
nav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", false);
  });
});

// ---------- 3. Work filters ----------
const filterButtons = document.querySelectorAll(".filter");
const cards = document.querySelectorAll(".card");

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const filter = button.dataset.filter;

    // Highlight the clicked button
    filterButtons.forEach((b) => b.classList.remove("active"));
    button.classList.add("active");

    // Show cards whose data-tags include the filter, hide the rest
    cards.forEach((card) => {
      const tags = card.dataset.tags.split(" ");
      const show = filter === "all" || tags.includes(filter);
      card.classList.toggle("hidden", !show);
    });
  });
});

// ---------- 4. Reveal sections as you scroll ----------
const revealTargets = document.querySelectorAll(".section, .hero");

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15 }
);

revealTargets.forEach((el) => {
  el.classList.add("reveal");
  observer.observe(el);
});
