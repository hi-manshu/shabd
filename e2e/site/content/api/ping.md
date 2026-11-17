---
title: Ping
description: Check that the service is up.
layout: api
api:
  method: GET
  path: /v1/ping/{region}
  baseUrl: https://api.fixture.test
  auth: none
---

Returns `pong`.

```sh
curl https://api.fixture.test/v1/ping/eu
```
