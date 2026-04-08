from datetime import datetime, UTC

from app.extensions import db


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    age_segment = db.Column(db.String(16), nullable=True)
    settings_json = db.Column(db.Text, nullable=False, default="{}")
    progress_json = db.Column(db.Text, nullable=False, default='{"completedScenarios":{},"quizScores":{},"badges":[]}')
    checklists_json = db.Column(db.Text, nullable=False, default="[]")
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(UTC))
    updated_at = db.Column(
        db.DateTime,
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
