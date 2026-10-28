# Use the ArchGuide MCP server from the Claude Code VS Code extension

This guide connects the ArchGuide MCP server to the Claude Code extension in VS Code, without
typing commands in a terminal. The example target repository is `H:/ProjectFolder`.
Replace that path with your own repository.

The extension reads the same MCP configuration as the Claude Code CLI. The simplest way to
add a server without a terminal is a `.mcp.json` file at the root of the target repository.

## Before you start

You need:

- Node.js 22.12 or later and pnpm 10 on your PATH.
- The Claude Code extension installed in VS Code.
- This repository at `H:/Zmaj-dev/ArchitectureGuide`.

Use forward slashes (`/`) in every path in JSON files. Backslashes must be escaped in JSON.

## Step 1: Install the dependencies of ArchitectureGuide

1. Open `H:/Zmaj-dev/ArchitectureGuide` in VS Code.
2. Open the Claude Code panel (the Claude icon in the activity bar, or the
   **Claude Code: Open** command).
3. Send this message:

   > Run `pnpm install` in this repository.

4. Approve the command when Claude asks.

## Step 2: Create the architecture workspace in the target repository

The MCP server needs an `architecture/` folder in the target repository.

1. In the same Claude Code panel, send:

   > Run `pnpm archguide -w H:/ProjectFolder/architecture init`

2. Approve the command.
3. Check that these now exist in the target repository:
   - `architecture/` (config, project file, `ARCHITECTURE.md`)
   - `.claude/skills/archguide/SKILL.md`

Use an absolute path for `-w`. A relative path makes the folder inside ArchitectureGuide.

## Step 3: Choose option A or option B

| | Option A: built file | Option B: from source |
|---|---|---|
| Extra step | Build once, and again after you change the ArchGuide code | None |
| Start-up | Fast | Slower (compiles TypeScript on start) |
| Recommended | Yes | For quick tests or while you change ArchGuide |

### Option A: build the MCP server

1. In the Claude Code panel (ArchitectureGuide window), send:

   > Run `pnpm --filter @archguide/cli run build`

2. Approve the command.
3. Check that this file exists:
   `H:/Zmaj-dev/ArchitectureGuide/packages/cli/dist/archguide-mcp.js`

### Option B: no build

Do nothing in this step. The server runs from the TypeScript sources.

## Step 4: Add `.mcp.json` to the target repository

1. Open `H:/ProjectFolder` in VS Code (**File → Open Folder**).
2. Create the file `.mcp.json` at the root of that folder.
3. Paste the content for the option you chose.

**Option A:**

```json
{
  "mcpServers": {
    "archguide": {
      "command": "node",
      "args": [
        "H:/Zmaj-dev/ArchitectureGuide/packages/cli/dist/archguide-mcp.js",
        "--workspace",
        "H:/ProjectFolder/architecture"
      ]
    }
  }
}
```

**Option B:**

```json
{
  "mcpServers": {
    "archguide": {
      "command": "cmd",
      "args": [
        "/c",
        "pnpm",
        "--silent",
        "--dir",
        "H:/Zmaj-dev/ArchitectureGuide",
        "archguide",
        "-w",
        "H:/ProjectFolder/architecture",
        "mcp"
      ]
    }
  }
}
```

Notes:

- On Windows, `pnpm` is a `.cmd` script, so option B starts it through `cmd /c`.
- Keep `--silent` in option B. Without it, pnpm writes a banner to stdout and the MCP
  connection fails.
- To give the agent read access only, add `"--read-only"` as the last item of `args`
  (option A) or after `"mcp"` (option B).
- To analyze code in a different folder than the parent of `architecture/`, add
  `"--repo", "H:/path/to/code"` (option A only).

4. Save the file.

The paths in `.mcp.json` are specific to your computer. If other people use the repository,
do not commit this file, or add `.mcp.json` to `.gitignore`.

## Step 5: Load and approve the server

1. Reload VS Code: **Ctrl+Shift+P → Developer: Reload Window**.
2. Open the Claude Code panel in the ProjectFolder window.
3. Claude Code asks if you trust the servers in `.mcp.json`. Approve `archguide`.
   If no prompt appears, go to step 4 of this list.
4. Type `/mcp` in the Claude Code panel and send it.
5. Check that `archguide` shows as connected.

If `archguide` shows as failed:

- Check every path in `.mcp.json`.
- Option A: check that `archguide-mcp.js` exists (step 3).
- Option B: check that `--silent` is in `args`.
- Check that `architecture/` exists in the target repository (step 2).
- Reload the window again after each fix.

## Step 6: Use the server

In the Claude Code panel of the ProjectFolder window, send messages such as:

- "Map this repository with archguide." Claude reads the code with `analyze_repository`,
  shows the suggestions, and adds them with `apply_analysis`.
- "Show the drift between the archguide model and the code." (`diff_with_repository`)
- "Generate dependency-cruiser rules from the architecture model." (`generate_enforcement`)
- "Review my current changes against the architecture." (`review-change` prompt)
- "Plan the feature X as an archguide change set." (`plan-feature` prompt)

The skill in `.claude/skills/archguide/` tells Claude how to use these tools.

## Optional: see the changes live in the editor

To watch the model change while Claude works, start the ArchGuide editor. In the Claude
Code panel of the ArchitectureGuide window, send:

> Run `pnpm archguide -w H:/ProjectFolder/architecture serve --open` in the background.

The browser opens the editor. Every change that Claude makes through MCP appears in the open
tab, and every change that you make in the browser is saved to the files.

## Update the server after you change ArchGuide

- Option A: run the build from step 3 again, then reload the window.
- Option B: reload the window.
