# Schema Migrations

Migration scripts transform backup data from an older schema version to a newer one.
Each script takes one argument: the path to the temp directory containing the backup data.

Naming: `v{old}-to-v{new}.sh`
Example: `v1-to-v2.sh` migrates schema version 1 to version 2.

Migrations are chained: a v1 backup restoring onto a v3 toolkit runs v1→v2, then v2→v3.
Migrations operate on a temp copy — the remote backup is never modified.
