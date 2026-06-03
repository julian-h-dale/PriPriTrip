import hmac
import os

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.auth import make_token
from app.routers import trip, trip_items
from app.schemas import AuthRequest


def create_app() -> FastAPI:
    application = FastAPI(title="PriPriTrip API")

    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(trip.router)
    application.include_router(trip_items.router)

    @application.get("/health", tags=["meta"])
    async def health():
        return {"status": "ok"}

    @application.post("/auth", tags=["meta"])
    async def auth(body: AuthRequest):
        app_password = os.environ.get("APP_PASSWORD", "honeymoon")
        if not hmac.compare_digest(body.password, app_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password"
            )
        token_secret = os.environ.get("TOKEN_SECRET", "dev-secret-change-me")
        token = make_token(body.password, token_secret)
        maps_api_key = os.environ.get("MAPS_API_KEY", "")
        return {"token": token, "mapsApiKey": maps_api_key}

    return application


app = create_app()
