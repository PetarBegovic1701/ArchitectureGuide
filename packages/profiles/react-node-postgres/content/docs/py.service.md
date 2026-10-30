---
id: py.service
kind: concept
title: Python service (API)
summary: A Python process that answers requests (FastAPI, Flask, Django). Like a Node service, it checks the caller, validates input, applies the rules and owns its data.
level: beginner
tracks: [foundations, concurrency-and-parallelism]
tags: [python, fastapi, flask, django, backend]
related:
  [
    node.service,
    node.route-handler,
    node.repository,
    pg.schema,
    calls,
    topic.event-loop-and-parallelism,
  ]
references:
  - title: FastAPI — First steps
    url: https://fastapi.tiangolo.com/tutorial/first-steps/
  - title: Flask — Quickstart
    url: https://flask.palletsprojects.com/en/stable/quickstart/
  - title: Django — Writing your first Django app
    url: https://docs.djangoproject.com/en/stable/intro/tutorial01/
  - title: Uvicorn — Deployment
    url: https://www.uvicorn.org/deployment/
---

## Beginner

A Python service is a backend process written in Python. It has the same job as a Node
service: it receives HTTP requests from the React app or from other services, checks who
is calling, validates the input, applies the business rules and reads or writes its own
data.

FastAPI and Flask map a function to a path (`@app.get("/orders")`). Django maps paths to
views in `urls.py`. A server such as Uvicorn or Gunicorn runs the application and accepts
the connections.

## Intermediate

- Validate every request at the edge. FastAPI does it with Pydantic models; Flask and
  Django need a form, a serializer or a schema library.
- Keep the routes thin. Put the work in services or use cases, and the SQL behind a
  repository (SQLAlchemy, the Django ORM).
- Give the service its own schema and migrations (Alembic or Django migrations). Other
  services use its API, not its tables.
- `async def` handlers share one event loop per process: a blocking call (a sync driver,
  a slow library) stops every other request of that process.

## Senior

- Python runs one thread of Python code at a time per process (the GIL). Scale with more
  processes (`gunicorn -w`, `uvicorn --workers`) and more instances, and size the
  database pool per process: instances × workers × pool size must fit Postgres.
- Move CPU-heavy or slow work to a worker (Celery, RQ, arq) instead of doing it in the
  request.
- Treat the OpenAPI document that FastAPI generates as the contract with the frontend,
  and generate the TypeScript client from it.

## Common mistakes

- Blocking calls inside `async def` handlers (the `requests` library, a sync database
  driver).
- A database pool per worker process that, multiplied by all processes, exceeds the
  connection limit of Postgres.
- Two services that write the same tables because they share one Django project or one
  SQLAlchemy model package.

## Examples

**A FastAPI route with a validated request:**

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class NewOrder(BaseModel):
    product_id: int
    quantity: int

@app.post("/orders", status_code=201)
async def create_order(order: NewOrder):
    return await orders.place(order)
```
