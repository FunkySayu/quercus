from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import trees

app = FastAPI(title="Localisation des chênes")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trees.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
