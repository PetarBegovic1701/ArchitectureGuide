import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createCatalog } from '@archguide/core';
import { profile } from '@archguide/profile-react-node-postgres';
import { Workspace } from '@archguide/workspace';
import type { McpContext } from './context';
import { registerPrompts } from './prompts';
import { registerResources } from './resources';
import { registerTools } from './tools';
import { registerAnalysisTools } from './analysis-tools';
import { registerChangeSetTools } from './change-set-tools';

export const SERVER_NAME = 'archguide';
export const SERVER_VERSION = '0.0.0';

const INSTRUCTIONS = `ArchGuide holds the architecture model of this repository (architecture/*.archguide.json).
Read it with get_architecture before changing code that crosses services or data stores.
Change it only through the write tools; each returns the new revision and only the findings the change introduced.
When "archguide serve" runs, every change shows up live in the open browser tab.`;

/** The catalog the CLI and the MCP server use: core concepts and the React/Node/PostgreSQL profile. */
export const defaultCatalog = () => createCatalog([profile]);

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, ctx);
  registerChangeSetTools(server, ctx);
  registerAnalysisTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server, ctx);
  return server;
}

export interface StdioOptions {
  /** The architecture folder (default: ./architecture). */
  workspace: string;
  readOnly?: boolean;
  /** The repository to analyze (default: the workspace's codeRoot). */
  repo?: string;
}

/** `archguide mcp`: serves the workspace over stdio until the client disconnects. */
export async function runStdio(options: StdioOptions): Promise<void> {
  const server = createMcpServer({
    workspace: new Workspace(options.workspace),
    catalog: defaultCatalog(),
    readOnly: options.readOnly ?? false,
    ...(options.repo ? { repo: options.repo } : {}),
  });
  await server.connect(new StdioServerTransport());
}
