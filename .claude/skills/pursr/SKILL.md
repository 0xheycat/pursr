```markdown
# pursr Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill introduces the development patterns and workflows used in the `pursr` JavaScript codebase. It covers coding conventions, file organization, and the primary workflow for incrementally fixing or adjusting server logic. The repository does not use a specific framework, and testing patterns are minimal but identifiable.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `myFeatureFile.js`

### Import Style
- Use **relative imports** to reference modules.
  ```javascript
  import { myFunction } from './utils/myHelper.js';
  ```

### Export Style
- Use **named exports** for functions, objects, or constants.
  ```javascript
  // In utils/myHelper.js
  export function myFunction() {
    // ...
  }
  ```

### Commit Messages
- Commit messages are **freeform** (no enforced prefixes).
- Average length: ~40 characters.
  - Example: `Fix bug in task assignment logic`

## Workflows

### Single File Feature/Fix
**Trigger:** When you need to fix or adjust logic in the Notion GitHub workflow MCP server.  
**Command:** `/fix-server-logic`

1. **Identify** the issue or improvement needed in the server logic.
2. **Edit** the file:  
   `examples/notion-github-workflow-mcp/src/server.js`  
   Make the necessary changes to address the issue.
3. **Commit** your change with a descriptive message.

**Example:**
```javascript
// Before
export function handleWebhook(req, res) {
  // buggy logic
}

// After
export function handleWebhook(req, res) {
  // improved logic
}
```

**Commit message example:**  
`Handle edge case for empty payloads in webhook`

## Testing Patterns

- Test files follow the pattern: `*.test.*`
  - Example: `server.test.js`
- The specific testing framework is **unknown**.
- Place tests alongside or near the files they test.

**Example:**
```javascript
// server.test.js
import { handleWebhook } from './server.js';

test('should handle empty payload', () => {
  // test implementation
});
```

## Commands

| Command           | Purpose                                               |
|-------------------|-------------------------------------------------------|
| /fix-server-logic | Apply incremental fixes or adjustments to server logic |
```
