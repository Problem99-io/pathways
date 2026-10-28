// MCP over stdio, for clients that launch servers as a subprocess
// (e.g. Claude Desktop). Talks to the running Pathways app over HTTP.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildMcpServer, httpApi } from './tools'

const base = process.env.PATHWAYS_URL || 'http://localhost:4317'
const server = buildMcpServer(httpApi(base))
await server.connect(new StdioServerTransport())
