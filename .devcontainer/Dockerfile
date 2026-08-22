# Debian + Node 22 (matches the repo's engines: ">=22").
FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# Agent CLIs, baked into an image layer (cached across rebuilds). Installed as
# the non-root `node` user so they land on that user's global npm prefix.
# Pin versions here (e.g. @openai/codex@0.x) if you want reproducible rebuilds.
RUN su node -c "npm install -g @openai/codex @anthropic-ai/claude-code"
