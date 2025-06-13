# Blueprint 05: Declarative Page Composition

**Objective:** To guide the agent in adopting a more robust, secure, and maintainable method for full-page self-modification by replacing raw HTML string generation with a declarative, JSON-based page composition definition.

---

### **1. The Problem with Raw HTML Generation**

The most direct way for an agent to modify its own UI is to generate the complete HTML source code as a single string (`full_html_source`). While powerful, this approach has significant drawbacks:

*   **Brittleness:** A single unclosed tag, misplaced quote, or syntax error in a massive string can render the entire page unusable, leading to a fatal error in the agent's evolution.
*   **Lack of Semantics:** A raw HTML string is just text. The agent cannot easily reason about its structure. It cannot ask "What scripts are loaded?" or "What web components are used?" without complex and error-prone string parsing.
*   **Security Risks:** Generating HTML from LLM output without rigorous sanitization creates a risk of injection attacks if the model can be prompted to include malicious `<script>` tags.
*   **Poor Maintainability:** Modifying a large, programmatically generated HTML string is difficult and error-prone for both the agent and a human overseer.

### **2. The Solution: Declarative `PAGE_COMPOSITION_DEF`**

A superior approach is to define the page structure declaratively using a structured JSON object. This blueprint introduces the `PAGE_COMPOSITION_DEF` artifact type. Instead of generating raw HTML, the agent generates a JSON object that describes the page's components. The harness or a utility function is then responsible for assembling this definition into a valid HTML document.

This separates the **intent** (the structure defined in JSON) from the **execution** (the process of building the final HTML string), making the entire process safer and more intelligent.

### **3. `PAGE_COMPOSITION_DEF` Artifact Structure**

The agent should be taught to generate a JSON object following this schema.

**Example `PAGE_COMPOSITION_DEF` Artifact:**

```json
{
  "doctype": "<!DOCTYPE html>",
  "html_attributes": {
    "lang": "en"
  },
  "head_elements": [
    {
      "type": "inline_tag",
      "tag": "meta",
      "attributes": { "charset": "UTF-8" }
    },
    {
      "type": "inline_tag",
      "tag": "title",
      "content": "REPLOID v2.0"
    },
    {
      "type": "artifact_id",
      "id": "/modules/ui-style.css"
    }
  ],
  "body_elements": [
    {
      "type": "web_component_tag",
      "tag": "status-bar",
      "attributes": { "title": "Agent Status" }
    },
    {
      "type": "artifact_id",
      "id": "/modules/ui-body-template.html"
    },
    {
        "type": "inline_html",
        "content": "<!-- Injected at runtime -->"
    }
  ],
  "script_references": [
    {
      "type": "artifact_id",
      "id": "/modules/app-logic.js",
      "attributes": { "defer": true }
    }
  ]
}
```

**Key Fields Explained:**

*   `doctype`: The HTML doctype declaration.
*   `html_attributes`: An object of key-value pairs for the `<html>` tag.
*   `head_elements`: An array of objects defining the contents of the `<head>`.
    *   `type: "inline_tag"`: Directly renders a tag with given attributes and content.
    *   `type: "artifact_id"`: Fetches the content from the specified VFS artifact and injects it. This is ideal for CSS files (`<style>...</style>`) or complex meta tags.
*   `body_elements`: An array defining the contents of the `<body>`.
    *   `type: "web_component_tag"`: Renders a custom element tag, allowing the agent to use its own created components.
    *   `type: "artifact_id"`: Injects the content of another HTML artifact.
    *   `type: "inline_html"`: Injects a raw string of HTML (use sparingly for safety).
*   `script_references`: An array defining scripts to be loaded.
    *   `type: "artifact_id"`: Fetches a JS artifact from the VFS and injects its content into a `<script>` tag. This is the primary way the agent includes its own logic.
    *   `attributes`: Allows setting `defer`, `async`, etc.

### **4. Implementation Pathway**

1.  **Educate the Agent:** The agent's core prompt (`prompt-system.md`) must be updated to teach it about this preferred method for page modification.
2.  **Implement Assembler Logic:** The `agent-cycle.js` module needs a new private function, `_assembleHtmlFromPageComposition(composition)`. This function will be responsible for:
    *   Iterating through the composition object.
    *   Fetching artifact content from the VFS using `Storage.getArtifactContent()`.
    *   Carefully building the final HTML string, ensuring proper escaping of attributes and content to prevent security issues.
3.  **Update Cycle Logic:** The main `executeCycle` function in `agent-cycle.js` should be modified to check if the LLM's response contains a `page_composition` object. If it does, it should call the new assembler function and handle the resulting HTML, for example, by staging it for a sandbox preview. This logic should be prioritized over a `full_html_source` field if both are present.