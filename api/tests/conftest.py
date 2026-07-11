import sys
import os

# Ensure the api/ directory is on sys.path so `app.*` imports resolve
# whether pytest is run from api/ or from the repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# The app fails fast at boot without a JWT secret; tests don't need a real one.
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")
