#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class PrismaMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'prisma-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'query_user',
            description: 'Query user data from the database',
            inputSchema: {
              type: 'object',
              properties: {
                userId: {
                  type: 'string',
                  description: 'User ID to query',
                },
                email: {
                  type: 'string',
                  description: 'Email to search for',
                },
              },
              required: [],
            },
          },
          {
            name: 'list_users',
            description: 'List all users in the database',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of users to return',
                  default: 10,
                },
              },
            },
          },
          {
            name: 'query_rsvp',
            description: 'Query RSVP data for events',
            inputSchema: {
              type: 'object',
              properties: {
                eventId: {
                  type: 'string',
                  description: 'Event ID to query RSVPs for',
                },
                userId: {
                  type: 'string',
                  description: 'User ID to query RSVPs for',
                },
              },
            },
          },
          {
            name: 'schema_info',
            description: 'Get information about the Prisma schema',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'execute_raw_query',
            description: 'Execute a raw SQL query (use with caution)',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Raw SQL query to execute',
                },
              },
              required: ['query'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'query_user':
            return await this.queryUser(args);
          case 'list_users':
            return await this.listUsers(args);
          case 'query_rsvp':
            return await this.queryRsvp(args);
          case 'schema_info':
            return await this.getSchemaInfo();
          case 'execute_raw_query':
            return await this.executeRawQuery(args);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Error executing ${name}: ${error.message}`);
      }
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'prisma://schema',
            name: 'Prisma Schema',
            description: 'The Prisma schema file',
            mimeType: 'text/plain',
          },
          {
            uri: 'prisma://models',
            name: 'Database Models',
            description: 'Information about database models',
            mimeType: 'application/json',
          },
        ],
      };
    });

    // Read resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      switch (uri) {
        case 'prisma://schema':
          return {
            contents: [
              {
                uri,
                mimeType: 'text/plain',
                text: await this.getSchemaContent(),
              },
            ],
          };
        case 'prisma://models':
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(await this.getModelsInfo(), null, 2),
              },
            ],
          };
        default:
          throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
      }
    });
  }

  async queryUser(args) {
    const { userId, email } = args;

    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { rsvps: true, identities: true },
      });
      return {
        content: [
          {
            type: 'text',
            text: `User found: ${JSON.stringify(user, null, 2)}`,
          },
        ],
      };
    }

    if (email) {
      const user = await prisma.user.findFirst({
        where: { email },
        include: { rsvps: true, identities: true },
      });
      return {
        content: [
          {
            type: 'text',
            text: `User found: ${JSON.stringify(user, null, 2)}`,
          },
        ],
      };
    }

    throw new Error('Either userId or email must be provided');
  }

  async listUsers(args) {
    const limit = args?.limit || 10;

    const users = await prisma.user.findMany({
      take: limit,
      include: { rsvps: true, identities: true },
    });

    return {
      content: [
        {
          type: 'text',
          text: `Found ${users.length} users: ${JSON.stringify(users, null, 2)}`,
        },
      ],
    };
  }

  async queryRsvp(args) {
    const { eventId, userId } = args;

    if (eventId) {
      const rsvps = await prisma.rsvp.findMany({
        where: { eventId },
        include: { user: true },
      });
      return {
        content: [
          {
            type: 'text',
            text: `RSVPs for event ${eventId}: ${JSON.stringify(rsvps, null, 2)}`,
          },
        ],
      };
    }

    if (userId) {
      const rsvps = await prisma.rsvp.findMany({
        where: { userId },
        include: { user: true },
      });
      return {
        content: [
          {
            type: 'text',
            text: `RSVPs for user ${userId}: ${JSON.stringify(rsvps, null, 2)}`,
          },
        ],
      };
    }

    throw new Error('Either eventId or userId must be provided');
  }

  async getSchemaInfo() {
    const models = await this.getModelsInfo();
    return {
      content: [
        {
          type: 'text',
          text: `Schema info: ${JSON.stringify(models, null, 2)}`,
        },
      ],
    };
  }

  async executeRawQuery(args) {
    const { query } = args;

    if (!query) {
      throw new Error('Query is required');
    }

    const result = await prisma.$queryRawUnsafe(query);
    return {
      content: [
        {
          type: 'text',
          text: `Query result: ${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  }

  async getModelsInfo() {
    // This is a simplified version - in a real implementation,
    // you might want to introspect the actual Prisma schema
    return {
      models: [
        {
          name: 'User',
          fields: ['id', 'firstName', 'lastName', 'email', 'createdAt', 'updatedAt'],
          relations: ['rsvps', 'identities'],
        },
        {
          name: 'Rsvp',
          fields: ['id', 'userId', 'eventId', 'status', 'createdAt', 'updatedAt'],
          relations: ['user'],
        },
        {
          name: 'Identity',
          fields: ['id', 'provider', 'providerUserId', 'userId', 'createdAt'],
          relations: ['user'],
        },
        {
          name: 'LinkCode',
          fields: ['code', 'userId', 'createdAt'],
        },
      ],
    };
  }

  async getSchemaContent() {
    // In a real implementation, you would read the actual schema.prisma file
    return `// Prisma schema content would be read from schema.prisma file
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
  engineType = "binary"
}

// Models: User, Rsvp, Identity, LinkCode`;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Prisma MCP server running on stdio');
  }

  async close() {
    await prisma.$disconnect();
  }
}

// Start the server
const server = new PrismaMCPServer();
server.run().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
