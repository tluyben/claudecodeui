# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code UI is a web-based interface for Anthropic's Claude Code CLI. It provides a responsive desktop and mobile UI for managing Claude Code projects, sessions, and interactions through both chat interface and integrated terminal access.

## Development Commands

### Core Commands
- `npm run dev` - Start development mode (runs both client and server with hot reload)
- `npm run server` - Run backend server only (Node.js/Express on port 3002)
- `npm run client` - Run frontend client only (Vite dev server on port 3001)
- `npm run build` - Build production frontend assets
- `npm run start` - Production mode (build + run server)

### Prerequisites
- Node.js v20 or higher
- Claude Code CLI installed and configured
- Environment configured via `.env` file (copy from `.env.example`)

## Architecture

### Full-Stack Structure
- **Frontend**: React 18 + Vite build system + Tailwind CSS
- **Backend**: Express.js server with WebSocket support
- **Integration**: Direct Claude CLI process spawning and management
- **Persistence**: SQLite database for auth, file system for Claude projects

### Key Directories
- `src/` - React frontend application
  - `components/` - UI components including ChatInterface, FileTree, Shell, GitPanel
  - `contexts/` - React contexts for auth and theme management
  - `hooks/` - Custom React hooks for audio recording and version checking
  - `utils/` - API client, WebSocket, and utility functions
- `server/` - Node.js backend
  - `routes/` - Express routes for git, auth, MCP integration
  - `database/` - SQLite database initialization and management
  - `middleware/` - Authentication and request validation

### Core Components
- **ChatInterface** (`src/components/ChatInterface.jsx`) - Main chat UI with Claude
- **Shell** (`src/components/Shell.jsx`) - Integrated terminal using xterm.js and node-pty
- **FileTree** (`src/components/FileTree.jsx`) - Interactive file explorer with CodeMirror editor
- **GitPanel** (`src/components/GitPanel.jsx`) - Git operations interface
- **ToolsSettings** (`src/components/ToolsSettings.jsx`) - Security-focused tool management

### Backend Integration
- **Claude CLI Integration** (`server/claude-cli.js`) - Process spawning and session management
- **Project Management** (`server/projects.js`) - Discovers and manages projects from `~/.claude/projects/`
- **WebSocket Server** - Real-time communication for chat and project updates
- **Authentication** - JWT-based auth with bcrypt password hashing

## Configuration Files

### Frontend Configuration
- `vite.config.js` - Vite build configuration with proxy setup for API routes
- `tailwind.config.js` - Tailwind CSS with custom theme variables and dark mode support
- `postcss.config.js` - PostCSS configuration for Tailwind processing

### Environment Variables
Configure via `.env` file:
- `PORT` - Backend server port (default: 3002)
- `VITE_PORT` - Frontend dev server port (default: 3001)
- Additional auth and database configuration options

## Security Model

**Important**: All Claude Code tools are disabled by default for security. Users must explicitly enable tools through the Tools Settings interface. This prevents potentially harmful operations from running automatically.

## Development Workflow

1. **Setup**: Install dependencies with `npm install`
2. **Environment**: Copy `.env.example` to `.env` and configure
3. **Development**: Use `npm run dev` for full-stack development with hot reload
4. **Frontend-only**: Use `npm run client` when working on UI components
5. **Backend-only**: Use `npm run server` when working on API or Claude integration

## Project Discovery

The application automatically discovers Claude Code projects from `~/.claude/projects/` directory and provides project management, session history, and chat interface integration.