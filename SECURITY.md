# Security Policy

## Supported scope

This repository is intended for self-hosted deployment. Operators are responsible for securing their own infrastructure, secrets, and network boundaries.

## Reporting a vulnerability

Please do not open a public issue for security-sensitive reports.

Send a private report to the project maintainer with:

- A description of the issue
- Reproduction steps
- Impact assessment
- Suggested remediation if available

The maintainer should acknowledge the report within 5 business days and coordinate a fix before public disclosure.

## Operational guidance

- Do not commit API keys, Jira tokens, or `.env` files.
- Use least-privilege credentials for Jira integrations.
- Restrict `CORS_ALLOW_ORIGINS` in non-local deployments.
- Treat uploaded files and generated documents as sensitive project data.
