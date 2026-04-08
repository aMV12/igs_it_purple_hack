"""Shared Flask extensions used across the application."""

from flask_sqlalchemy import SQLAlchemy


# The SQLAlchemy instance is created once and initialized inside create_app.
db = SQLAlchemy()
