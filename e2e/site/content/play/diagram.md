---
title: A diagram
---

The build turns pages into files:

```mermaid
flowchart LR
  pages[Markdown pages] --> build{shabd build}
  build --> site[Static site]
```

And one that cannot be read:

```mermaid
flowchart LR
  this is not --> a diagram ((
```
