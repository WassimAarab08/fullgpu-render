# Security policy

Please **do not** open public issues for security problems.
Report them privately through [GitHub private vulnerability reporting](https://github.com/WassimAarab08/fullgpu-render/security/advisories/new).
You should get a first answer within 7 days.

Worth reporting: the local benchmark server in `browser/server.mjs` (path traversal, request handling), and anything
that lets a crafted layout JSON or media file run code or read files outside the media folder.
