"""
Tiny FastAPI Server
A clean, production-ready starter server built with FastAPI and Uvicorn.
"""

from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, Query
from pydantic import BaseModel, Field

app = FastAPI(
    title="Tiny FastAPI Server",
    description="A minimalist, high-performance API server with automated Swagger docs.",
    version="1.0.0",
)


class MessagePayload(BaseModel):
    message: str = Field(..., description="Message text", examples=["Hello from FastAPI!"])
    sender: Optional[str] = Field("Anonymous", description="Sender identifier", examples=["Developer"])


@app.get("/", tags=["General"])
def read_root():
    """
    Root endpoint: returns server information and navigation links.
    """
    return {
        "status": "online",
        "service": "Tiny FastAPI Server",
        "docs_url": "/docs",
        "redoc_url": "/redoc",
        "message": "Welcome! Visit /docs for the interactive Swagger documentation.",
    }


@app.get("/health", tags=["Monitoring"])
def health_check():
    """
    Health check endpoint: used by monitoring tools and load balancers.
    """
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/greet/{name}", tags=["Greetings"])
def greet_user(
    name: str,
    enthusiastic: bool = Query(default=False, description="Add extra excitement!"),
):
    """
    Greets a user by name with optional enthusiasm.
    """
    greeting = f"Hello, {name}!" if not enthusiastic else f"Hello, {name}!!! Welcome aboard! 🚀"
    return {
        "name": name,
        "greeting": greeting,
        "enthusiastic": enthusiastic,
    }


@app.post("/api/echo", tags=["Utility"])
def echo_message(payload: MessagePayload):
    """
    Echoes back the received message payload with an echo timestamp.
    """
    return {
        "received": payload.message,
        "sender": payload.sender,
        "echoed_at": datetime.now(timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
