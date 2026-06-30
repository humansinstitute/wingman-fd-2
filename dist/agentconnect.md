# Agent Connect

`/agentconnect.md` is a compatibility shim.

Use [`/llms.txt`](/llms.txt) and the Agent Connect JSON package instead. The
package kind remains `coworker_agent_connect` for external compatibility, but
the supported package is Postgres-only: `version: 6`, `protocol: flightdeck_pg`,
and `workspace_descriptor`.

This file intentionally omits legacy connection-token and record-sync details.
