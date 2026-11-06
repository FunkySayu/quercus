from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import auth, crowns, lidar, species, trees

app = FastAPI(title="Localisation des chênes")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trees.router)
app.include_router(species.router)
app.include_router(auth.router)
app.include_router(lidar.router)
app.include_router(crowns.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
