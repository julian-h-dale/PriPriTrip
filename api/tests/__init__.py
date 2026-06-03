import sys
import os

# Allow `from main import ...` when pytest is run from any directory.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
