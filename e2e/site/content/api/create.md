---
title: Create a note
description: Store a note for a region.
layout: api
api:
  method: POST
  path: /v1/regions/:region/notes
  baseUrl: https://api.fixture.test
  auth: Bearer token
  try: true
  body:
    text: Hello
    pinned: false
---

Stores a note and answers with it.
