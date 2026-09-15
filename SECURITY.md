# Security Policy

## Supported versions

Until Condiments reaches 1.0, security fixes are applied to the latest release and the `main` branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue for an unpatched vulnerability.

Include the affected command or adapter, host environment, reproduction steps, impact, and any suggested mitigation. Remove API keys, access tokens, private prompts, source code, and transcript contents.

Condiments writes local state and may merge host hook configuration. Reports involving unsafe paths, command execution, secret exposure, or restoration of host configuration receive priority.
