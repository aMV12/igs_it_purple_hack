import json
import os
import re

from flask import Flask, abort, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from app.content.data import ABOUT_SOURCES, AGE_SEGMENTS, BASICS_MODULES, GLOSSARY, SCENARIOS
from app.extensions import db
from app.models import User


def create_app() -> Flask:
    flask_app = Flask(__name__)
    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif not database_url:
        database_url = "sqlite:///igs.db"

    flask_app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    flask_app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    flask_app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "igs-dev-secret-key")
    db.init_app(flask_app)

    with flask_app.app_context():
        db.create_all()

    scenario_map = {scenario["slug"]: scenario for scenario in SCENARIOS}
    scenario_categories = list(dict.fromkeys(scenario["category"] for scenario in SCENARIOS))

    def current_user() -> User | None:
        user_id = session.get("user_id")
        if not user_id:
            return None
        return db.session.get(User, user_id)

    def is_meaningful_progress(progress: dict) -> bool:
        if not isinstance(progress, dict):
            return False
        return bool(progress.get("completedScenarios") or progress.get("quizScores") or progress.get("badges"))

    @flask_app.template_filter("tidy_sentence")
    def tidy_sentence(value: str) -> str:
        if not isinstance(value, str):
            return value
        text = value.strip()
        if not text or text[-1] not in ".!?":
            return text

        punctuation_marks = re.findall(r"[.!?]", text)
        if len(punctuation_marks) == 1:
            return text[:-1]
        return text

    @flask_app.context_processor
    def inject_globals():
        return {
            "nav_items": [
                {"title": "Сценарии", "endpoint": "scenarios"},
                {"title": "Основы", "endpoint": "basics"},
                {"title": "Словарь", "endpoint": "glossary"},
                {"title": "Профиль", "endpoint": "profile"},
                {"title": "О проекте", "endpoint": "about"},
            ],
            "age_segments": AGE_SEGMENTS,
            "scenario_categories": scenario_categories,
            "current_user": current_user(),
        }

    @flask_app.route("/")
    def home():
        return render_template(
            "home.html",
            featured_scenario=SCENARIOS[0],
            scenario_of_day=SCENARIOS[1],
            scenarios=SCENARIOS,
            basics_modules=BASICS_MODULES,
        )

    @flask_app.route("/scenarios")
    def scenarios():
        return render_template(
            "scenarios.html",
            scenarios=SCENARIOS,
            scenario_categories=scenario_categories,
            scenario_of_day=SCENARIOS[1],
        )

    @flask_app.route("/scenarios/<slug>")
    def scenario_detail(slug: str):
        scenario = scenario_map.get(slug)
        if not scenario:
            abort(404)
        return render_template("scenario_detail.html", scenario=scenario, glossary=GLOSSARY, scenarios=SCENARIOS)

    @flask_app.route("/basics")
    def basics():
        return render_template("basics.html", basics_modules=BASICS_MODULES, scenarios=SCENARIOS)

    @flask_app.route("/glossary")
    def glossary():
        return render_template("glossary.html", glossary=GLOSSARY, scenarios=SCENARIOS)

    @flask_app.route("/profile")
    def profile():
        return render_template("profile.html", scenarios=SCENARIOS, basics_modules=BASICS_MODULES)

    @flask_app.route("/about")
    def about():
        return render_template("about.html", sources=ABOUT_SOURCES, scenarios=SCENARIOS)

    @flask_app.route("/auth", methods=["GET", "POST"])
    def auth():
        if request.method == "GET":
            return render_template("auth.html", auth_mode=request.args.get("mode", "login"))

        username = request.form.get("username", "").strip()
        password = request.form.get("password", "").strip()
        mode = request.form.get("mode", "login")

        if len(username) < 3 or len(username) > 32:
            return render_template("auth.html", error="Логин должен быть от 3 до 32 символов", auth_mode=mode), 400
        if len(password) < 4:
            return render_template("auth.html", error="Пароль должен быть не короче 4 символов", auth_mode=mode), 400

        if mode == "register":
            existing = User.query.filter_by(username=username).first()
            if existing:
                return render_template("auth.html", error="Такой логин уже занят", auth_mode=mode), 400
            user = User(username=username, password_hash=generate_password_hash(password))
            db.session.add(user)
            db.session.commit()
            session["user_id"] = user.id
            return redirect(url_for("profile"))

        user = User.query.filter_by(username=username).first()
        if not user or not check_password_hash(user.password_hash, password):
            return render_template("auth.html", error="Неверный логин или пароль", auth_mode=mode), 400
        session["user_id"] = user.id
        return redirect(url_for("profile"))

    @flask_app.post("/logout")
    def logout():
        session.clear()
        return redirect(url_for("home"))

    @flask_app.route("/api/state", methods=["GET", "POST"])
    def api_state():
        user = current_user()
        if not user:
            if request.method == "GET":
                return jsonify({"authenticated": False})
            return jsonify({"authenticated": False, "error": "auth_required"}), 401

        if request.method == "POST":
            payload = request.get_json(silent=True) or {}

            if "ageSegment" in payload:
                age_segment = payload.get("ageSegment")
                user.age_segment = age_segment if isinstance(age_segment, str) and age_segment else None

            if "settings" in payload and isinstance(payload["settings"], dict):
                user.settings_json = json.dumps(payload["settings"], ensure_ascii=False)

            if "progress" in payload and is_meaningful_progress(payload["progress"]):
                user.progress_json = json.dumps(payload["progress"], ensure_ascii=False)

            if "checklists" in payload and isinstance(payload["checklists"], list):
                user.checklists_json = json.dumps(payload["checklists"][:12], ensure_ascii=False)

            db.session.commit()

        return jsonify(
            {
                "authenticated": True,
                "user": {"username": user.username},
                "ageSegment": user.age_segment,
                "settings": json.loads(user.settings_json or "{}"),
                "progress": json.loads(user.progress_json or '{"completedScenarios":{},"quizScores":{},"badges":[]}'),
                "checklists": json.loads(user.checklists_json or "[]"),
            }
        )

    @flask_app.route("/health")
    def health():
        return {
            "status": "ok",
            "service": "igs-smart-guide",
            "scenarios": len(SCENARIOS),
            "glossary_terms": len(GLOSSARY),
        }

    return flask_app


app = create_app()
