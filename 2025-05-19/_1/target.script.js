// LLM Prompt Challenge - Game Logic
// Version 0.1 - Foundation

document.addEventListener("DOMContentLoaded", () => {
  console.log("LLM Prompt Challenge Game Loaded!");

  const submitButton = document.getElementById("submit-prompt");
  const userPromptTextarea = document.getElementById("user-prompt");
  const targetOutputDiv = document.getElementById("target-output");
  const llmResponseDiv = document.getElementById("llm-response");
  const feedbackDiv = document.getElementById("feedback-area");

  // Placeholder for game initialization
  function initializeGame() {
    console.log("Initializing game...");
    // For now, let's set a static target
    targetOutputDiv.innerHTML =
      "<p><strong>Target:</strong> A three-sentence horror story about a haunted toaster.</p>";
    llmResponseDiv.innerHTML =
      "<p><em>The LLM eagerly awaits your creative genius!</em></p>";
    feedbackDiv.innerHTML =
      "<p><em>Remember, the right words can unlock wonders.</em></p>";
  }

  // Placeholder for handling prompt submission
  function handleSubmitPrompt() {
    const prompt = userPromptTextarea.value;
    console.log("User prompt submitted:", prompt);

    if (!prompt.trim()) {
      feedbackDiv.innerHTML =
        "<p style='color: orange;'>Please enter a prompt first. Let your imagination flow!</p>";
      return;
    }

    // Simulate LLM processing (replace with actual LLM call later)
    llmResponseDiv.innerHTML = `<p><strong>Simulated LLM Response to:</strong> "${prompt}"</p><p><em>...beep boop... thinking ...</em></p><p>The toaster, acquired from a dusty antique shop, began to whisper secrets of burnt offerings and forgotten breakfasts. Its metallic slot glowed with an eerie, orange light, not from heating coils, but from a hunger that toast alone could not satisfy. Every morning, it demanded a new story, a new sacrifice of words, lest it start toasting more than just bread.</p>`;

    // Simulate feedback (replace with actual scoring/feedback later)
    feedbackDiv.innerHTML =
      "<p style='color: green;'>That's an interesting attempt! The LLM has spoken. How close were you to the target?</p>";

    // For a real game, you'd compare the llmResponse to the targetOutput
    // and provide more specific feedback.
  }

  if (submitButton) {
    submitButton.addEventListener("click", handleSubmitPrompt);
  } else {
    console.error(
      "Submit button not found! The story cannot begin without it."
    );
  }

  initializeGame();
});
