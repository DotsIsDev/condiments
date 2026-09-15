# Delivery Architecture

Constraints: offline writes must survive process crashes; deployment has one local database; remote delivery is eventually consistent.

Decision: use `sqlite-outbox` because one transaction can persist domain state and pending delivery before asynchronous retries.

Rejected: in-memory queue loses work on crashes. Rejected: distributed broker adds unsupported infrastructure.

