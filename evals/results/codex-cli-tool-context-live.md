# Live Codex Tool Context Evaluation

Generated: 2026-09-14T21:58:35.706Z

Codex CLI cannot lazily alter active tool schemas. none/some expose both MCP servers; full uses an isolated host override to disable the unrelated server.

| Mode | Input tokens | Cache read | Uncached input | Output tokens | Total tokens | Required MCP calls | Quality |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| none | 38379 | 33024 | 5355 | 205 | 38584 | 1 | pass |
| some | 38391 | 29952 | 8439 | 176 | 38567 | 1 | pass |
| full | 38434 | 33024 | 5410 | 219 | 38653 | 1 | pass |

| Mode vs none | Input reduction | Uncached input reduction | Output reduction | Total reduction | Quality |
| --- | ---: | ---: | ---: | ---: | --- |
| some | -0.031% | -57.591% | 14.146% | 0.044% | pass |
| full | -0.143% | -1.027% | -6.829% | -0.179% | pass |

Budget: 115804/300000 observed tokens; 60000 reserved for delayed accounting.
