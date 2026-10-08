

document.addEventListener("DOMContentLoaded", function () {
  const steps = document.querySelectorAll(".form-step");
  const nextBtns = document.querySelectorAll(".next-btn");
  const prevBtns = document.querySelectorAll(".prev-btn");
  const summaryBox = document.getElementById("summaryBox");
  let currentStep = 0;

  function showStep(step) {
    steps.forEach((s, i) => {
      s.classList.toggle("active", i === step);
    });
  }

  // Next button handler
  nextBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const currentForm = steps[currentStep];
      const inputs = currentForm.querySelectorAll("input, select, textarea");

      // Validation
      for (let input of inputs) {
        if (!input.checkValidity()) {
          input.reportValidity();
          return;
        }
      }

      currentStep++;
      if (currentStep >= steps.length) {
        currentStep = steps.length - 1;
      }

      showStep(currentStep);

      // Generate summary if last step
      if (currentStep === steps.length - 1) {
        generateSummary();
      }
    });
  });

  // Previous button handler
  prevBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentStep--;
      if (currentStep < 0) {
        currentStep = 0;
      }
      showStep(currentStep);
    });
  });

  // Function to generate summary
  function generateSummary() {
    const formData = new FormData(document.querySelector("form"));
    let summaryHtml = "<ul>";

    for (let [key, value] of formData.entries()) {
      if (key === "agree_terms") continue; // skip checkbox
      summaryHtml += `<li><strong>${formatLabel(key)}:</strong> ${value}</li>`;
    }

    summaryHtml += "</ul>";
    summaryBox.innerHTML = summaryHtml;
  }

  // Convert field name to readable label
  function formatLabel(key) {
    const labels = {
      ecsCard: "ECS Card",
      ecs_card_type: "Application Type",
      full_name: "Full Name",
      dob: "Date of Birth",
      ni_number: "NI Number",
      gender: "Gender",
      test_type: "Test Type",
      test_language: "Test Language",
      test_centre: "Test Centre",
      test_date: "Test Date",
      test_time: "Test Time",
      street_address: "Street Address",
      city: "City",
      postcode: "Postcode",
      mobile: "Mobile",
      email: "Email",
      confirm_email: "Confirm Email"
    };
    return labels[key] || key;
  }

  // Show first step initially
  showStep(currentStep);
});
