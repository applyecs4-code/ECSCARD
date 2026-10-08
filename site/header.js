// ===================== COMMON.JS =====================

// ✅ Load Header & Footer automatically on every page
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // --- Load Header ---
    const headerContainer = document.createElement("div");
    headerContainer.id = "header-container";
    document.body.prepend(headerContainer);

    const headerRes = await fetch("header.html");
    if (!headerRes.ok) throw new Error("Header file not found");
    const headerHTML = await headerRes.text();
    headerContainer.innerHTML = headerHTML;

    // ✅ Initialize all header-related scripts AFTER header injected
    initHeaderBehaviour();
    initScrollEffect();
    initCartBadge();

    // --- Load Footer ---
    const footerContainer = document.createElement("div");
    footerContainer.id = "footer-container";
    document.body.append(footerContainer);

    const footerRes = await fetch("footer.html");
    if (!footerRes.ok) throw new Error("Footer file not found");
    const footerHTML = await footerRes.text();
    footerContainer.innerHTML = footerHTML;

    // ✅ Page-specific interactive features
    initReviewSlider();
    initFAQAccordion();

  } catch (e) {
    console.error("❌ Header/Footer load failed:", e);
  }
});

// ===================== HEADER BEHAVIOUR (Hamburger + Dropdowns) =====================

function initHeaderBehaviour() {
  const hamburger = document.getElementById("hamburger");
  const navMenu = document.getElementById("navMenu");
  const accordionHeaders = document.querySelectorAll(".accordion-header");
  const navLinks = document.querySelectorAll("#navMenu a");

  // -------- HAMBURGER TOGGLE (Mobile Menu) --------
  if (hamburger && navMenu) {
    hamburger.addEventListener("click", () => {
      hamburger.classList.toggle("active");
      navMenu.classList.toggle("active");
    });

    // -------- CLOSE MOBILE MENU ON RESIZE --------
    window.addEventListener("resize", () => {
      if (window.innerWidth > 992) {
        navMenu.classList.remove("active");
        hamburger.classList.remove("active");
      }
    });
  }

  // -------- CLOSE MENU ON LINK CLICK (Mobile UX) --------
  navLinks.forEach(link => {
    link.addEventListener("click", () => {
      if (window.innerWidth <= 992 && hamburger && navMenu) {
        navMenu.classList.remove("active");
        hamburger.classList.remove("active");
      }
    });
  });

  // -------- ACCORDION DROPDOWN (CLICK TO OPEN/CLOSE) --------
  accordionHeaders.forEach(button => {
    const content = button.nextElementSibling;
    if (!content) return;

    button.addEventListener("click", () => {
      const isOpen = button.classList.contains("active");

      if (isOpen) {
        // band karo
        button.classList.remove("active");
        content.style.display = "none";
      } else {
        // open karo
        button.classList.add("active");
        content.style.display = "flex";
      }
    });
  });
}

// ===================== SCROLL EFFECT (Header shadow etc.) =====================

function initScrollEffect() {
  window.addEventListener(
    "scroll",
    function () {
      // header ko safely pick karo (agar class change ho toh bhi)
      const header =
        document.querySelector("header.header") ||
        document.querySelector("#header-container header");
      if (!header) return;

      if (window.scrollY > 10) {
        header.classList.add("scrolled");
      } else {
        header.classList.remove("scrolled");
      }
    },
    { passive: true }
  );
}

// ===================== REVIEW SLIDER =====================

function initReviewSlider() {
  const wrapper = document.getElementById("reviewWrapper");
  const dots = document.querySelectorAll(".dot");
  const totalSlides = dots.length;

  if (!wrapper || totalSlides === 0) return;

  let currentSlide = 0;

  function moveToSlide(slideIndex) {
    currentSlide = slideIndex;
    wrapper.style.transform = `translateX(-${slideIndex * 100}%)`;

    dots.forEach(dot => dot.classList.remove("active"));
    if (dots[slideIndex]) {
      dots[slideIndex].classList.add("active");
    }
  }

  // Auto slide only if more than 1 slide
  if (totalSlides > 1) {
    setInterval(() => {
      currentSlide = (currentSlide + 1) % totalSlides;
      moveToSlide(currentSlide);
    }, 5000);
  }

  // Dots click events
  dots.forEach((dot, index) => {
    dot.addEventListener("click", () => moveToSlide(index));
  });
}

// ===================== FAQ ACCORDION =====================

function initFAQAccordion() {
  const faqItems = document.querySelectorAll(".faq-item");
  if (!faqItems.length) return;

  faqItems.forEach(item => {
    const question = item.querySelector(".faq-question");
    if (!question) return;

    question.addEventListener("click", () => {
      // Close all other FAQ items
      faqItems.forEach(i => {
        if (i !== item) i.classList.remove("active");
      });

      // Toggle current FAQ item
      item.classList.toggle("active");
    });
  });
}

// ===================== CART BADGE =====================
function initCartBadge() {
  try {
    const n = (JSON.parse(localStorage.getItem("ecsCart")) || []).reduce((s, i) => s + i.qty, 0);
    document.querySelectorAll(".cart-badge").forEach(b => { b.textContent = n; b.style.display = n ? "inline-block" : "none"; });
  } catch (e) {}
}
