# Entry point for uvicorn: `uvicorn main:app`
# All application logic lives in the app/ package.
from app.main import app  # noqa: F401
