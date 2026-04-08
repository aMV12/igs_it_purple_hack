"""Local entrypoint for running the Flask application without Gunicorn."""

import os

from app import app


if __name__ == "__main__":
    # Keep the local entrypoint compatible with Render-style PORT injection.
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8000")), debug=False)
