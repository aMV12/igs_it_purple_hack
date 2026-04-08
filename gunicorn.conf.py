import os


bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
worker_class = "gthread"
threads = int(os.getenv("GUNICORN_THREADS", "4"))
workers = int(os.getenv("GUNICORN_WORKERS", "2"))
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))
graceful_timeout = int(os.getenv("GUNICORN_GRACEFUL_TIMEOUT", "30"))
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "5"))
accesslog = "-"
errorlog = "-"
capture_output = True
